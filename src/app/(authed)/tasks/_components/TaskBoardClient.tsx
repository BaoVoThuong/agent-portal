"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { OPEN_TASK_EVENT, writeTaskDeepLink } from "@/lib/tasks/client-events";
import { TASKS_TOPIC } from "@/lib/tasks/realtime-topics";
import { Clock, Plus, Tag, UsersRound } from "lucide-react";
import type { TaskCategory, TaskRow, TaskSlaRule, TaskStatus } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import {
  filterTasks,
  NO_AGENT,
  type QuickFilter,
} from "@/lib/tasks/filtering";
import { isTaskOverdue } from "@/lib/tasks/sla";
import { KanbanBoard } from "./KanbanBoard";
import { BacklogBoard } from "./BacklogBoard";
import { TaskListView } from "./TaskListView";
import {
  TaskToolbar,
  type AgentStat,
  type BoardView,
  type TaskDatePresetKey,
  type TaskDateRangeDefault,
  type TaskDateRangeValue,
} from "./TaskToolbar";
import { NewTaskDialog, type NewTaskPayload } from "./NewTaskDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { CategoryManager } from "./CategoryManager";
import { AgentGroupsModal } from "./AgentGroupsModal";
import { SlaRulesModal } from "./SlaRulesModal";
import { ReasonModal } from "./ReasonModal";

// Countdown/overdue labels only need to refresh every so often, not on every
// render — 30s keeps the board close to live without a timer per card.
const SLA_TICK_MS = 30_000;
const TEAM_STATUS_CONFIRMED_KEY = "team_status_confirmed";

export function TaskBoardClient({
  initialTasks,
  initialNowIso,
  boardTitle,
  isManager,
  currentEmail,
  assignees,
  agents,
  agentCandidates,
  myAgents,
  myAssistantAgents,
  agentMembersByAgent,
  initialCategories,
}: {
  initialTasks: TaskRow[];
  initialNowIso: string;
  boardTitle: string;
  isManager: boolean;
  currentEmail: string;
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  agentCandidates: TaskAgent[];
  myAgents: string[];
  myAssistantAgents: string[];
  agentMembersByAgent: Record<string, string[]>;
  initialCategories: TaskCategory[];
}) {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("task");
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [taskAgents, setTaskAgents] = useState<TaskAgent[]>(agents);
  const [view, setView] = useState<BoardView>("board");
  const [openId, setOpenId] = useState<string | null>(() => deepLinkId);
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState<TaskCategory[]>(initialCategories);
  const [managingCategories, setManagingCategories] = useState(false);
  const [managingAgentGroups, setManagingAgentGroups] = useState(false);
  const [managingSlaRules, setManagingSlaRules] = useState(false);
  const [slaRules, setSlaRules] = useState<TaskSlaRule[]>([]);
  const [unlockingTaskId, setUnlockingTaskId] = useState<string | null>(null);
  const [reopeningTaskId, setReopeningTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(initialNowIso));
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [presets, setPresets] = useState<QuickFilter[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [showTeamTasks, setShowTeamTasks] = useState(false);
  const [newAssignedTaskIds, setNewAssignedTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const initialDateRangeDefault = useMemo(
    () => getFallbackTaskDateRangeDefault(),
    []
  );
  const [dateRangeDefault, setDateRangeDefault] = useState(
    initialDateRangeDefault
  );
  const defaultDateRange = useMemo(
    () => resolveTaskDateRangeDefault(dateRangeDefault),
    [dateRangeDefault]
  );
  const [dateRange, setDateRange] = useState(() =>
    resolveTaskDateRangeDefault(initialDateRangeDefault)
  );
  const [error, setError] = useState<string | null>(null);
  const missingOpenRefetchId = useRef<string | null>(null);
  // Full-list refetches race with direct mutations (drag status PATCH,
  // assign, reopen, delete). Keep separate clocks so a realtime/refetch
  // response that started from an older snapshot cannot overwrite an
  // optimistic local move and cause the card to flash back for a second.
  const tasksWriteVersionRef = useRef(0);
  const tasksRefetchRequestRef = useRef(0);
  const pendingTaskMutationsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedDefault = readTaskDateRangeDefault();
      setDateRangeDefault(storedDefault);
      setDateRange(resolveTaskDateRangeDefault(storedDefault));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  // Auto-dismiss the error toast so it doesn't linger.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const onOpenTask = (event: Event) => {
      const taskId = (event as CustomEvent<{ taskId?: unknown }>).detail?.taskId;
      if (typeof taskId !== "string" || taskId.length === 0) return;
      setOpenId(taskId);
      writeTaskDeepLink(taskId, "push");
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpenTask);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpenTask);
  }, []);

  useEffect(() => {
    const onHistoryNavigation = () => {
      const taskId = new URL(window.location.href).searchParams.get("task");
      setOpenId(taskId);
    };
    window.addEventListener("popstate", onHistoryNavigation);
    return () => window.removeEventListener("popstate", onHistoryNavigation);
  }, []);

  const loadUnreadAssignedTaskIds = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as { unreadAssignedTaskIds?: unknown };
      const ids = Array.isArray(data.unreadAssignedTaskIds)
        ? data.unreadAssignedTaskIds.filter((id): id is string => typeof id === "string")
        : [];
      setNewAssignedTaskIds(new Set(ids));
    } catch {
      // Notification state is a visual hint only; the next task/notification
      // refresh will repair it.
    }
  }, []);

  const markAssignedNotificationRead = useCallback(async (taskId: string) => {
    await fetch("/api/tasks/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, type: "assigned" }),
    }).catch(() => {});
  }, []);

  const markNewAssignedTaskSeen = useCallback((taskId: string) => {
    if (!newAssignedTaskIds.has(taskId)) return;
    setNewAssignedTaskIds((current) => {
      if (!current.has(taskId)) return current;
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
    void markAssignedNotificationRead(taskId);
  }, [markAssignedNotificationRead, newAssignedTaskIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUnreadAssignedTaskIds(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUnreadAssignedTaskIds]);

  useEffect(() => {
    if (!openId || !newAssignedTaskIds.has(openId)) return;
    const timer = window.setTimeout(() => markNewAssignedTaskSeen(openId), 0);
    return () => window.clearTimeout(timer);
  }, [markNewAssignedTaskSeen, newAssignedTaskIds, openId]);

  // Live board: refetch the role-filtered list when the server pings that tasks
  // changed, plus once on (re)connect to catch anything missed while offline.
  // No polling — the reconnect refetch is the self-heal path.
  const refetchTasks = useCallback(async () => {
    const requestId = ++tasksRefetchRequestRef.current;
    const writeVersionAtStart = tasksWriteVersionRef.current;
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = await res.json();
      // A newer refetch, a local write, or an in-flight direct mutation means
      // this full-list payload may be older than what the user just did.
      if (tasksRefetchRequestRef.current !== requestId) return;
      if (tasksWriteVersionRef.current !== writeVersionAtStart) return;
      if (pendingTaskMutationsRef.current.size > 0) return;
      tasksWriteVersionRef.current += 1;
      setTasks(data.tasks as TaskRow[]);
      void loadUnreadAssignedTaskIds();
    } catch {
      // ignore; the next ping or reconnect retries
    }
  }, [loadUnreadAssignedTaskIds]);

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

  useEffect(() => {
    if (!openId) {
      missingOpenRefetchId.current = null;
      return;
    }
    if (tasks.some((task) => task.id === openId)) {
      missingOpenRefetchId.current = null;
      return;
    }
    if (missingOpenRefetchId.current === openId) return;
    missingOpenRefetchId.current = openId;
    const timer = window.setTimeout(() => void refetchTasks(), 0);
    return () => window.clearTimeout(timer);
  }, [openId, tasks, refetchTasks]);

  const reloadCategories = async () => {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setCategories((await res.json()).categories as TaskCategory[]);
  };

  const reloadSlaRules = useCallback(async () => {
    const res = await fetch("/api/admin/task-sla-rules");
    if (res.ok) setSlaRules((await res.json()).rules as TaskSlaRule[]);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void reloadSlaRules(), 0);
    return () => clearTimeout(timer);
  }, [reloadSlaRules]);

  useEffect(() => {
    const refreshNow = () => setNow(new Date());
    const firstTick = window.setTimeout(refreshNow, 0);
    const timer = window.setInterval(refreshNow, SLA_TICK_MS);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, []);

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
    for (const person of assignees) {
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
  }, [assignees, currentEmail]);

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
        overdue: 0,
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
      if (isTaskOverdue(task, slaRules, now)) stat.overdue += 1;
      if (task.status === "done") stat.done += 1;
      if (task.priority === "urgent" || task.priority === "high") stat.urgent += 1;
    }

    const selectedAgentEmails = new Set(taskAgents.map((agent) => agent.email));
    return [...stats.values()].filter(
      (stat) => stat.total > 0 || selectedAgentEmails.has(stat.key)
    );
  }, [agentChoices, taskAgents, tasks, slaRules, now]);

  const overdueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      if (isTaskOverdue(task, slaRules, now)) ids.add(task.id);
    }
    return ids;
  }, [tasks, slaRules, now]);

  const isMyOwnAgentAccount = agents.some((agent) => agent.email === currentEmail);
  const manageableAgentEmails = isMyOwnAgentAccount
    ? [...new Set([currentEmail, ...myAssistantAgents])]
    : myAssistantAgents;
  const canManageOwnAgentGroup = manageableAgentEmails.length > 0;
  const shouldLimitPlainCsTasks = !isManager && !canManageOwnAgentGroup;
  const displayNewAssignedTaskIds = useMemo(() => {
    const ids = new Set<string>();
    if (!shouldLimitPlainCsTasks) return ids;

    for (const task of tasks) {
      if (
        task.status === "todo" &&
        task.assignees.includes(currentEmail) &&
        newAssignedTaskIds.has(task.id)
      ) {
        ids.add(task.id);
      }
    }

    return ids;
  }, [currentEmail, newAssignedTaskIds, shouldLimitPlainCsTasks, tasks]);
  const scopedTasks = useMemo(() => {
    if (!shouldLimitPlainCsTasks || showTeamTasks) return tasks;

    return tasks.filter(
      (task) =>
        task.assignees.includes(currentEmail) ||
        task.viewer_is_participant === true
    );
  }, [currentEmail, shouldLimitPlainCsTasks, showTeamTasks, tasks]);

  // Which filters make sense for the current view + role. Hidden filters are also
  // forced inert here so a stale value can't silently filter a view that hides it.
  //  - Agent (customer agent_email): manager-only.
  //  - Assignee: manager-only, and not on Backlog (everything there is unassigned).
  //  - Status: List only (Board columns already are statuses; Backlog is all backlog).
  //  - Category: hidden for plain CS users.
  const showAgentFilter = isManager;
  const showAssigneeFilter = isManager && view !== "backlog";
  const showStatusFilter = view === "list";
  const showCategoryFilter = !shouldLimitPlainCsTasks;

  const visibleTasks = useMemo(
    () =>
      filterTasks(scopedTasks, {
        query,
        agent: showAgentFilter ? agentFilter : [],
        assignee: showAssigneeFilter ? assigneeFilter : [],
        quick: presets,
        category: showCategoryFilter ? categoryFilter : [],
        status: showStatusFilter ? statusFilter : [],
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        currentEmail,
        overdueIds,
        searchText: (task) => {
          const category = task.category_id ? categoryById.get(task.category_id) : null;
          return [
            task.title,
            task.description,
            task.fub_link,
            task.agent_email,
            task.agent_email ? agentLabelByEmail.get(task.agent_email) : null,
            ...task.assignees.map(
              (email) => assigneeLabelByEmail.get(email) ?? email
            ),
            task.reporter_email,
            category?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        },
      }),
    [
      scopedTasks,
      query,
      agentFilter,
      assigneeFilter,
      presets,
      categoryFilter,
      statusFilter,
      dateRange,
      showAgentFilter,
      showAssigneeFilter,
      showStatusFilter,
      showCategoryFilter,
      currentEmail,
      categoryById,
      agentLabelByEmail,
      assigneeLabelByEmail,
      overdueIds,
    ]
  );

  const openTask = tasks.find((t) => t.id === openId) ?? null;

  function openTaskById(id: string) {
    markNewAssignedTaskSeen(id);
    setOpenId(id);
    writeTaskDeepLink(null);
  }
  function closeTask() {
    setOpenId(null);
    writeTaskDeepLink(null);
  }

  function beginTaskMutation(id: string) {
    const current = pendingTaskMutationsRef.current.get(id) ?? 0;
    pendingTaskMutationsRef.current.set(id, current + 1);
    return () => {
      const next = (pendingTaskMutationsRef.current.get(id) ?? 1) - 1;
      if (next > 0) {
        pendingTaskMutationsRef.current.set(id, next);
      } else {
        pendingTaskMutationsRef.current.delete(id);
      }
    };
  }

  // Every write to `tasks` — optimistic or confirmed — goes through this so a
  // stale in-flight refetch can never clobber a more-recent one.
  function updateTasks(updater: (prev: TaskRow[]) => TaskRow[]) {
    tasksWriteVersionRef.current += 1;
    setTasks(updater);
  }

  function replaceTask(updated: TaskRow) {
    updateTasks((prev) =>
      prev.map((task) =>
        task.id === updated.id
          ? {
              ...updated,
              viewer_is_participant:
                updated.viewer_is_participant ?? task.viewer_is_participant,
            }
          : task
      )
    );
  }

  // "Agent owner" rights extend to a promoted Assistant of that agent —
  // same standing as the agent themself, just not the agent's own account.
  function isAgentOwnerOrAssistantOf(agentEmail: string | null): boolean {
    if (!agentEmail) return false;
    return agentEmail === currentEmail || myAssistantAgents.includes(agentEmail);
  }

  function isAgentTeamMemberOf(agentEmail: string | null): boolean {
    return Boolean(
      agentEmail && (agentMembersByAgent[agentEmail] ?? []).includes(currentEmail)
    );
  }

  function canChangeStatusTask(task: TaskRow): boolean {
    return (
      isManager ||
      task.assignees.includes(currentEmail) ||
      isAgentTeamMemberOf(task.agent_email) ||
      isAgentOwnerOrAssistantOf(task.agent_email)
    );
  }

  function needsTeamStatusConfirm(
    task: TaskRow,
    patch: Record<string, unknown>
  ) {
    return (
      !isManager &&
      typeof patch.status === "string" &&
      patch.status !== task.status &&
      !task.assignees.includes(currentEmail) &&
      !isAgentOwnerOrAssistantOf(task.agent_email) &&
      isAgentTeamMemberOf(task.agent_email)
    );
  }

  function canReviewDoneTask(task: TaskRow): boolean {
    return task.status === "done" && (isManager || isAgentOwnerOrAssistantOf(task.agent_email));
  }

  function canDeleteOpenTask(task: TaskRow): boolean {
    return isManager || isAgentOwnerOrAssistantOf(task.agent_email);
  }

  function reviewDoneTask(id: string, reviewed: boolean) {
    void patchTask(id, { done_reviewed: reviewed });
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    // Snapshot only the affected task so a failed update reverts just this card,
    // never clobbering other concurrent optimistic moves.
    const before = tasks.find((t) => t.id === id) ?? null;
    const revert = () => {
      if (before) updateTasks((cur) => cur.map((t) => (t.id === id ? before : t)));
    };
    let requestPatch = patch;
    if (before && needsTeamStatusConfirm(before, patch)) {
      const confirmed = window.confirm(
        "This task is assigned to someone in your team. Change its status?"
      );
      if (!confirmed) return;
      requestPatch = { ...patch, [TEAM_STATUS_CONFIRMED_KEY]: true };
    }
    const finishPendingMutation = beginTaskMutation(id);
    const optimisticPatch = buildOptimisticTaskPatch(patch, currentEmail, before);
    updateTasks((cur) =>
      cur.map((t) => (t.id === id ? ({ ...t, ...optimisticPatch } as TaskRow) : t))
    );

    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPatch),
      });
    } catch {
      finishPendingMutation();
      revert();
      setError("Mất kết nối — không lưu được thay đổi.");
      return;
    }
    if (!res.ok) {
      finishPendingMutation();
      revert();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Không cập nhật được task.");
      return;
    }
    const data = await res.json();
    replaceTask(data.task as TaskRow);
    finishPendingMutation();
  }

  function moveTask(id: string, change: { status: TaskStatus; position: number }) {
    void patchTask(id, change);
  }

  async function submitOverdueUnlock(reason: string): Promise<boolean> {
    const id = unlockingTaskId;
    if (!id) return false;
    const finishPendingMutation = beginTaskMutation(id);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}/overdue-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } catch {
      finishPendingMutation();
      setError("Connection lost — could not reopen the task.");
      return false;
    }
    if (!res.ok) {
      finishPendingMutation();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not reopen the task.");
      return false;
    }
    const data = await res.json();
    replaceTask(data.task as TaskRow);
    finishPendingMutation();
    setUnlockingTaskId(null);
    return true;
  }

  async function submitReopen(reason: string): Promise<boolean> {
    const id = reopeningTaskId;
    if (!id) return false;
    const finishPendingMutation = beginTaskMutation(id);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } catch {
      finishPendingMutation();
      setError("Connection lost — could not reopen the task.");
      return false;
    }
    if (!res.ok) {
      finishPendingMutation();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not reopen the task.");
      return false;
    }
    const data = await res.json();
    replaceTask(data.task as TaskRow);
    finishPendingMutation();
    setReopeningTaskId(null);
    return true;
  }

  async function changeAssignee(id: string, email: string, assigned: boolean) {
    const before = tasks.find((t) => t.id === id) ?? null;
    if (!before) return;
    const finishPendingMutation = beginTaskMutation(id);

    const nextAssignees = assigned
      ? [...new Set([...before.assignees, email])]
      : before.assignees.filter((assignee) => assignee !== email);
    const nextStatus =
      nextAssignees.length === 0
        ? "backlog"
        : before.status === "backlog"
          ? "todo"
          : before.status;
    const nowIso = new Date().toISOString();
    const optimistic: TaskRow = {
      ...before,
      assignees: nextAssignees,
      assignee_email: nextAssignees[0] ?? null,
      status: nextStatus,
      todo_started_at:
        before.status === "backlog" && nextStatus === "todo"
          ? nowIso
          : before.todo_started_at,
    };
    updateTasks((cur) => cur.map((task) => (task.id === id ? optimistic : task)));

    let res: Response;
    try {
      res = await fetch(
        assigned
          ? `/api/tasks/${id}/assignees`
          : `/api/tasks/${id}/assignees/${encodeURIComponent(email)}`,
        {
          method: assigned ? "POST" : "DELETE",
          headers: assigned ? { "Content-Type": "application/json" } : undefined,
          body: assigned ? JSON.stringify({ email }) : undefined,
        }
      );
    } catch {
      finishPendingMutation();
      updateTasks((cur) => cur.map((task) => (task.id === id ? before : task)));
      setError("Mất kết nối — không cập nhật được assignee.");
      return;
    }

    if (!res.ok) {
      finishPendingMutation();
      updateTasks((cur) => cur.map((task) => (task.id === id ? before : task)));
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Không cập nhật được assignee.");
      return;
    }

    const data = await res.json();
    replaceTask(data.task as TaskRow);
    finishPendingMutation();
  }

  async function createTask(payload: NewTaskPayload) {
    let res: Response;
    try {
      res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setError("Mất kết nối — không tạo được task.");
      throw new Error("Failed to create task.");
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Không tạo được task.");
      throw new Error(data?.error ?? "Failed to create task.");
    }
    const data = await res.json();
    updateTasks((cur) => [...cur, data.task as TaskRow]);
  }

  async function deleteTask(id: string) {
    const prev = tasks;
    const finishPendingMutation = beginTaskMutation(id);
    updateTasks((cur) => cur.filter((t) => t.id !== id));
    setOpenId(null);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    } catch {
      finishPendingMutation();
      updateTasks(() => prev);
      setError("Mất kết nối — không xoá được task.");
      return;
    }
    if (!res.ok) {
      finishPendingMutation();
      updateTasks(() => prev);
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Không xoá được task.");
      return;
    }
    finishPendingMutation();
  }

  function clearAllFilters() {
    setQuery("");
    setAgentFilter([]);
    setAssigneeFilter([]);
    setPresets([]);
    setCategoryFilter([]);
    setStatusFilter([]);
    setShowTeamTasks(false);
    setDateRange(defaultDateRange);
  }

  function saveDefaultDateRange(nextDefault: TaskDateRangeDefault) {
    setDateRangeDefault(nextDefault);
    writeTaskDateRangeDefault(nextDefault);
  }

  const canAssignOpen =
    openTask !== null && (isManager || isAgentOwnerOrAssistantOf(openTask.agent_email));
  const canEditOpen =
    openTask !== null &&
    (isManager ||
      isAgentOwnerOrAssistantOf(openTask.agent_email) ||
      openTask.reporter_email === currentEmail);
  const canDeleteOpen = openTask !== null && canDeleteOpenTask(openTask);
  const canCreateTasks = isManager || canManageOwnAgentGroup;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-[#172b4d]">
      <div className="shrink-0 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold text-[#172b4d]">
            {boardTitle}
          </h1>

          <div className="flex items-center gap-2">
            {(isManager || canManageOwnAgentGroup) && (
              <button
                type="button"
                onClick={() => setManagingAgentGroups(true)}
                className="inline-flex h-9 items-center gap-2 rounded border border-transparent bg-[#f4f5f7] px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#ebecf0]"
              >
                <UsersRound className="h-4 w-4" />
                Agent Groups
              </button>
            )}
            {isManager && (
              <>
                <button
                  type="button"
                  onClick={() => setManagingCategories(true)}
                  className="inline-flex h-9 items-center gap-2 rounded border border-transparent bg-[#f4f5f7] px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#ebecf0]"
                >
                  <Tag className="h-4 w-4" />
                  Categories
                </button>
                <button
                  type="button"
                  onClick={() => setManagingSlaRules(true)}
                  className="inline-flex h-9 items-center gap-2 rounded border border-transparent bg-[#f4f5f7] px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#ebecf0]"
                >
                  <Clock className="h-4 w-4" />
                  SLA Times
                </button>
              </>
            )}
            {canCreateTasks && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc]"
              >
                <Plus className="h-4 w-4" />
                New task
              </button>
            )}
          </div>
        </div>

        <TaskToolbar
          view={view}
          onViewChange={setView}
          isManager={isManager}
          showBacklog={isManager || canManageOwnAgentGroup}
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
          dateFrom={dateRange.from}
          dateTo={dateRange.to}
          defaultDateRange={defaultDateRange}
          onDateRange={setDateRange}
          onDefaultDateRange={saveDefaultDateRange}
          showAgent={showAgentFilter}
          showAssignee={showAssigneeFilter}
          showStatus={showStatusFilter}
          showCategory={showCategoryFilter}
          showTeamTasksToggle={shouldLimitPlainCsTasks}
          teamTasksEnabled={showTeamTasks}
          onTeamTasksEnabledChange={setShowTeamTasks}
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
          canReviewDoneTask={canReviewDoneTask}
          onReviewDone={reviewDoneTask}
          categories={categories}
          assigneeLabelByEmail={assigneeLabelByEmail}
          newAssignedTaskIds={displayNewAssignedTaskIds}
          useAssigneeTodoClock={shouldLimitPlainCsTasks && !showTeamTasks}
          rules={slaRules}
          now={now}
          onUnlockOverdue={setUnlockingTaskId}
          onReopenRequest={setReopeningTaskId}
        />
      )}

      {view === "list" && (
        <TaskListView
          tasks={visibleTasks}
          categories={categories}
          assignees={assignees}
          isManager={isManager}
          myAssistantAgents={myAssistantAgents}
          agentMembersByAgent={agentMembersByAgent}
          currentEmail={currentEmail}
          onOpen={openTaskById}
          onPatch={patchTask}
          canReviewDoneTask={canReviewDoneTask}
          onReviewDone={reviewDoneTask}
          onAssigneeChange={changeAssignee}
          overdueIds={overdueIds}
          newAssignedTaskIds={displayNewAssignedTaskIds}
          onUnlockOverdue={setUnlockingTaskId}
          onReopenRequest={setReopeningTaskId}
        />
      )}

      {view === "backlog" && (isManager || canManageOwnAgentGroup) && (
        <BacklogBoard
          tasks={visibleTasks}
          assignees={assignees}
          agents={taskAgents}
          agentMembersByAgent={agentMembersByAgent}
          categories={categories}
          onOpen={openTaskById}
          onPatch={patchTask}
          onAssigneeChange={changeAssignee}
          onReorder={(id, position) => patchTask(id, { position })}
          onCreate={createTask}
        />
      )}

      {creating && canCreateTasks ? (
        <NewTaskDialog
          open={creating}
          isManager={isManager}
          currentEmail={currentEmail}
          myAssistantAgents={myAssistantAgents}
          assignees={assignees}
          agents={taskAgents}
          agentCandidates={agentCandidates}
          myAgents={myAgents}
          agentMembersByAgent={agentMembersByAgent}
          categories={categories}
          onClose={() => setCreating(false)}
          onCreate={createTask}
        />
      ) : null}

      {openTask && (
        <TaskDetailDrawer
          key={openTask.id}
          task={openTask}
          canEdit={canEditOpen}
          canAssign={canAssignOpen}
          canDelete={canDeleteOpen}
          canChangeStatus={openTask !== null && canChangeStatusTask(openTask)}
          onReopenRequest={() => setReopeningTaskId(openTask.id)}
          assignees={assignees}
          agentMembersByAgent={agentMembersByAgent}
          agents={taskAgents}
          mentionMembers={mentionMembers}
          categories={categories}
          currentEmail={currentEmail}
          canReviewDone={canReviewDoneTask(openTask)}
          onClose={closeTask}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onReviewDone={(reviewed) => reviewDoneTask(openTask.id, reviewed)}
          onAssigneeChange={(email, assigned) =>
            changeAssignee(openTask.id, email, assigned)
          }
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
        isManager={isManager}
        manageableAgentEmails={manageableAgentEmails}
        onAgentsChange={setTaskAgents}
        onClose={() => setManagingAgentGroups(false)}
      />

      <SlaRulesModal
        open={managingSlaRules}
        categories={categories}
        rules={slaRules}
        onRulesChange={setSlaRules}
        onClose={() => setManagingSlaRules(false)}
      />

      <ReasonModal
        open={unlockingTaskId !== null}
        title="Reopen overdue task"
        description="Enter a reason to move this overdue task back to To Do."
        placeholder="Reason for the delay..."
        submitLabel="Reopen"
        accentColor="#de350b"
        onClose={() => setUnlockingTaskId(null)}
        onSubmit={submitOverdueUnlock}
      />

      <ReasonModal
        open={reopeningTaskId !== null}
        title="Reopen task"
        description="This task is Done/Cancelled. Enter a reason to move it back to To Do."
        placeholder="Reason for reopening..."
        submitLabel="Reopen"
        accentColor="#0c66e4"
        onClose={() => setReopeningTaskId(null)}
        onSubmit={submitReopen}
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

function optimisticElapsedSeconds(startIso: string | null | undefined, nowIso: string): number {
  if (!startIso) return 0;
  return Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(startIso).getTime()) / 1000));
}

function buildOptimisticTaskPatch(
  patch: Record<string, unknown>,
  currentEmail: string,
  before?: TaskRow | null
): Record<string, unknown> {
  const optimistic = { ...patch };

  // Mirror transitions.ts so the card doesn't flicker before the server
  // responds: bank the leaving stage's seconds into its accumulator (never
  // reset to 0), clear its start, then open the new stage. Overdue markers are
  // deliberately NOT cleared — a repeat offender keeps its Overdue tag.
  if (typeof optimistic.status === "string" && before && optimistic.status !== before.status) {
    const nowIso = new Date().toISOString();
    optimistic.done_reviewed_by_email = null;
    optimistic.done_reviewed_at = null;

    if (before.status === "todo" && before.todo_started_at) {
      optimistic.todo_seconds =
        (before.todo_seconds ?? 0) + optimisticElapsedSeconds(before.todo_started_at, nowIso);
      optimistic.todo_started_at = null;
    } else if (before.status === "in_progress" && before.in_progress_at) {
      optimistic.in_progress_seconds =
        (before.in_progress_seconds ?? 0) +
        optimisticElapsedSeconds(before.in_progress_at, nowIso);
      optimistic.in_progress_at = null;
    } else if (before.status === "waiting" && before.waiting_started_at) {
      optimistic.waiting_seconds =
        (before.waiting_seconds ?? 0) +
        optimisticElapsedSeconds(before.waiting_started_at, nowIso);
      optimistic.waiting_started_at = null;
    }

    if (optimistic.status === "todo") {
      optimistic.todo_started_at = nowIso;
    } else if (optimistic.status === "in_progress") {
      optimistic.in_progress_at = nowIso;
    } else if (optimistic.status === "waiting") {
      optimistic.waiting_started_at = nowIso;
      optimistic.waiting_reminded_at = null;
    }

    if (optimistic.status === "done" || optimistic.status === "cancel") {
      optimistic.closed_at = nowIso;
    } else if (before.status === "done" || before.status === "cancel") {
      optimistic.closed_at = null;
    }
  }

  if (typeof optimistic.done_reviewed === "boolean") {
    const reviewed = optimistic.done_reviewed;
    delete optimistic.done_reviewed;
    optimistic.done_reviewed_by_email = reviewed ? currentEmail : null;
    optimistic.done_reviewed_at = reviewed ? new Date().toISOString() : null;
  }

  return optimistic;
}

const TASK_DATE_RANGE_DEFAULT_STORAGE_KEY = "eps.tasks.dateRangeDefault.v1";

const TASK_DATE_PRESET_KEYS: TaskDatePresetKey[] = [
  "fixed",
  "today",
  "yesterday",
  "thisMonth",
  "last7",
  "last14",
  "last30",
  "all",
];

function getFallbackTaskDateRangeDefault(): TaskDateRangeDefault {
  return {
    preset: "thisMonth",
    ...getTaskPresetDateRange("thisMonth"),
  };
}

function readTaskDateRangeDefault(): TaskDateRangeDefault {
  const fallback = getFallbackTaskDateRangeDefault();

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(
      TASK_DATE_RANGE_DEFAULT_STORAGE_KEY
    );
    if (!rawValue) return fallback;

    const parsedValue = JSON.parse(rawValue) as Partial<TaskDateRangeDefault>;
    if (!isTaskDatePresetKey(parsedValue.preset)) return fallback;

    if (parsedValue.preset === "fixed") {
      return {
        preset: "fixed",
        ...normalizeTaskDateRange({
          from: isDateKey(parsedValue.from) ? parsedValue.from : "",
          to: isDateKey(parsedValue.to) ? parsedValue.to : "",
        }),
      };
    }

    if (parsedValue.preset === "all") {
      return { preset: "all", from: "", to: "" };
    }

    return {
      preset: parsedValue.preset,
      ...getTaskPresetDateRange(parsedValue.preset),
    };
  } catch {
    return fallback;
  }
}

function writeTaskDateRangeDefault(value: TaskDateRangeDefault) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    TASK_DATE_RANGE_DEFAULT_STORAGE_KEY,
    JSON.stringify(value)
  );
}

function resolveTaskDateRangeDefault(
  value: TaskDateRangeDefault
): TaskDateRangeValue {
  if (value.preset === "fixed") {
    return normalizeTaskDateRange(value);
  }

  return getTaskPresetDateRange(value.preset);
}

function getTaskPresetDateRange(preset: TaskDatePresetKey): TaskDateRangeValue {
  const today = new Date();
  const todayKey = toDateInputValue(today);

  switch (preset) {
    case "today":
      return { from: todayKey, to: todayKey };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      const yesterdayKey = toDateInputValue(yesterday);
      return { from: yesterdayKey, to: yesterdayKey };
    }
    case "thisMonth": {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toDateInputValue(firstDay), to: todayKey };
    }
    case "last7":
      return { from: toDateInputValue(addDays(today, -6)), to: todayKey };
    case "last14":
      return { from: toDateInputValue(addDays(today, -13)), to: todayKey };
    case "last30":
      return { from: toDateInputValue(addDays(today, -29)), to: todayKey };
    case "all":
    case "fixed":
      return { from: "", to: "" };
  }
}

function normalizeTaskDateRange(value: TaskDateRangeValue): TaskDateRangeValue {
  if (value.from && value.to && value.from.localeCompare(value.to) > 0) {
    return { from: value.to, to: value.from };
  }

  if (value.from && !value.to) return { from: value.from, to: value.from };
  if (!value.from && value.to) return { from: value.to, to: value.to };

  return { from: value.from, to: value.to };
}

function isTaskDatePresetKey(value: unknown): value is TaskDatePresetKey {
  return (
    typeof value === "string" &&
    TASK_DATE_PRESET_KEYS.includes(value as TaskDatePresetKey)
  );
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(date: Date, amount: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
