"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { OPEN_TASK_EVENT, writeTaskDeepLink } from "@/lib/tasks/client-events";
import { TASKS_TOPIC } from "@/lib/tasks/realtime-topics";
import { resolveTaskCapabilities } from "@/lib/tasks/access";
import { ChevronDown, Clock, Download, Loader2, Plus } from "lucide-react";
import type {
  TaskCategory,
  TaskPriority,
  TaskRow,
  TaskSlaRule,
  TaskStatus,
} from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import {
  filterTasks,
  NO_AGENT,
  type QuickFilter,
} from "@/lib/tasks/filtering";
import { formatEmailAsName } from "@/lib/tasks/people";
import {
  readHiddenTaskListColumns,
  toggleHiddenTaskListColumn,
  writeHiddenTaskListColumns,
} from "@/lib/tasks/list-column-visibility";
import {
  resolveLayout,
  serializeLayout,
  type LayoutEntry,
} from "@/lib/table-config/layout";
import { isTaskOverdue } from "@/lib/tasks/sla";
import { KanbanBoard } from "./KanbanBoard";
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
import { SlaRulesModal } from "./SlaRulesModal";
import { ReasonModal } from "./ReasonModal";
import { CSWorkloadOverview } from "./CSWorkloadOverview";
import { Toast } from "../../_shared/Toast";
import { useAnchoredMenu } from "./use-anchored-menu";
import {
  TASK_LIST_DEFAULT_HIDDEN_COLUMN_KEYS,
  TASK_LIST_LOCKED_COLUMN_KEYS,
  taskListColumnsFromConfig,
  visibleTaskListColumns,
  type TaskListColumnKey,
} from "./task-list-columns";
import {
  optimisticallyAssignOverviewTask,
} from "@/lib/tasks/overview";
import type { OverviewSnapshot } from "@/lib/tasks/overview-types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";

// Countdown/overdue labels only need to refresh every so often, not on every
// render — 30s keeps the board close to live without a timer per card.
const SLA_TICK_MS = 30_000;

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

type PendingTaskPatch = {
  sequence: number;
  patch: Record<string, unknown>;
};

type TaskMutationState = {
  confirmed: TaskRow;
  pending: PendingTaskPatch[];
  nextSequence: number;
  tail: Promise<void>;
};

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
  tableColumns,
  tableColumnOptions,
  canExport,
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
  tableColumns: TableColumn[];
  tableColumnOptions: TableColumnOption[];
  canExport: boolean;
}) {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("task");
  const deepLinkCommentId = searchParams.get("comment");
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const taskRowsRef = useRef(new Map(initialTasks.map((task) => [task.id, task])));
  const taskMutationStatesRef = useRef(new Map<string, TaskMutationState>());
  const [view, setView] = useState<BoardView>("list");
  const [overviewSnapshot, setOverviewSnapshot] = useState<OverviewSnapshot | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewNotice, setOverviewNotice] = useState<string | null>(null);
  const [assigningOverviewTaskId, setAssigningOverviewTaskId] = useState<string | null>(null);
  const [selectedOverviewTaskId, setSelectedOverviewTaskId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => deepLinkId);
  const [openCommentId, setOpenCommentId] = useState<string | null>(
    () => deepLinkCommentId
  );
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState<TaskCategory[]>(initialCategories);
  const [taskLayoutColumns, setTaskLayoutColumns] = useState<TableColumn[]>(tableColumns);
  const [managingSlaRules, setManagingSlaRules] = useState(false);
  const [slaRules, setSlaRules] = useState<TaskSlaRule[]>([]);
  const [unlockingTaskId, setUnlockingTaskId] = useState<string | null>(null);
  const [reopeningTaskId, setReopeningTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(initialNowIso));
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>(() => {
    const ownsAgent = agents.some((agent) => agent.email === currentEmail);
    const plainCs = !isManager && !ownsAgent && myAssistantAgents.length === 0;
    return plainCs ? [currentEmail] : [];
  });
  const [presets, setPresets] = useState<QuickFilter[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [hiddenTaskListColumnKeys, setHiddenTaskListColumnKeys] = useState<
    Set<TaskListColumnKey>
  >(() => new Set(TASK_LIST_DEFAULT_HIDDEN_COLUMN_KEYS));
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
  // Set when a refetch response was withheld because a local write was in
  // flight. Those responses can carry OTHER people's updates, so they must be
  // re-run once writes settle rather than discarded until the next ping.
  const tasksRefetchDirtyRef = useRef(false);
  // Lets refetchTasks re-run itself without a self-referencing useCallback.
  const refetchTasksRef = useRef<(() => void) | null>(null);
  const overviewRangeKeyRef = useRef<string | null>(null);
  const taskLayoutHydratedRef = useRef(false);
  // Per-task safety net on top of the version/pending guards above: even if a
  // background refetch's response somehow reflects a slightly-behind snapshot
  // (a race the in-flight/version checks don't fully rule out — e.g. a
  // realtime broadcast arriving before this tab's own PATCH response), a task
  // that was written to locally within the last few seconds keeps its LOCAL
  // value instead of being overwritten by that refetch. This is what stops a
  // just-moved card from flashing back to its old column for ~1s.
  const recentTaskWritesRef = useRef(new Map<string, number>());

  const taskListColumnConfig = useMemo(
    () => taskListColumnsFromConfig(taskLayoutColumns),
    [taskLayoutColumns]
  );

  useEffect(() => {
    if (taskLayoutHydratedRef.current) return;
    taskLayoutHydratedRef.current = true;
    let alive = true;
    const initialTaskListColumns = taskListColumnsFromConfig(tableColumns);
    const initialTaskListColumnKeySet = new Set(initialTaskListColumns.map((column) => column.key));
    const initialTaskListDefaultHiddenKeys = new Set<TaskListColumnKey>([
      ...TASK_LIST_DEFAULT_HIDDEN_COLUMN_KEYS,
      ...tableColumns
        .filter((column) => column.hidden_default)
        .map((column) => column.key as TaskListColumnKey),
    ]);
    const timer = window.setTimeout(() => {
      const storedDefault = readTaskDateRangeDefault();
      setDateRangeDefault(storedDefault);
      setDateRange(resolveTaskDateRangeDefault(storedDefault));
      void fetch("/api/config/layout?scope=cs")
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { layout?: unknown } | null) => {
          if (!alive) return;
          if (Array.isArray(payload?.layout)) {
            const resolved = resolveLayout(tableColumns, payload.layout as LayoutEntry[]);
            setTaskLayoutColumns(
              // Keep hidden_default as the admin's own global default (already
              // correct on `column` via resolveLayout's spread of tableColumns)
              // — this user's resolved per-column visibility lives separately
              // in hiddenTaskListColumnKeys below. Overwriting it here would
              // make an archived column (hidden_default: true) silently read
              // as "not archived" for any user who already had it visible in
              // their own saved layout.
              resolved.map((column, index) => ({
                ...column,
                position: (index + 1) * 10,
              }))
            );
            setHiddenTaskListColumnKeys(
              new Set(
                resolved
                  .filter(
                    (column) =>
                      column.hidden &&
                      !column.pinned &&
                      !TASK_LIST_LOCKED_COLUMN_KEYS.has(column.key)
                  )
                  .map((column) => column.key as TaskListColumnKey)
              )
            );
            return;
          }
          setTaskLayoutColumns(tableColumns);
          setHiddenTaskListColumnKeys(
            readHiddenTaskListColumns(
              browserStorage(),
              initialTaskListColumnKeySet,
              TASK_LIST_LOCKED_COLUMN_KEYS,
              initialTaskListDefaultHiddenKeys
            ) as Set<TaskListColumnKey>
          );
        })
        .catch(() => {
          if (!alive) return;
          setTaskLayoutColumns(tableColumns);
          setHiddenTaskListColumnKeys(
            readHiddenTaskListColumns(
              browserStorage(),
              initialTaskListColumnKeySet,
              TASK_LIST_LOCKED_COLUMN_KEYS,
              initialTaskListDefaultHiddenKeys
            ) as Set<TaskListColumnKey>
          );
        });
    }, 0);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [tableColumns]);

  // Auto-dismiss the error toast so it doesn't linger.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!overviewNotice) return;
    const timer = setTimeout(() => setOverviewNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [overviewNotice]);

  useEffect(() => {
    const onOpenTask = (event: Event) => {
      const detail = (
        event as CustomEvent<{ taskId?: unknown; commentId?: unknown }>
      ).detail;
      const taskId = detail?.taskId;
      if (typeof taskId !== "string" || taskId.length === 0) return;
      const commentId =
        typeof detail?.commentId === "string" && detail.commentId.length > 0
          ? detail.commentId
          : null;
      setOpenId(taskId);
      setOpenCommentId(commentId);
      writeTaskDeepLink(taskId, "push", commentId);
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpenTask);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpenTask);
  }, []);

  useEffect(() => {
    const onHistoryNavigation = () => {
      const params = new URL(window.location.href).searchParams;
      const taskId = params.get("task");
      setOpenId(taskId);
      setOpenCommentId(params.get("comment"));
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
      // A superseded request needs no re-run — the newer one carries at least
      // as much. The other two DO: they mean this payload had real updates
      // (possibly other people's tasks) that we are choosing not to apply
      // right now, so mark it dirty and re-run once writes settle instead of
      // dropping those updates on the floor until some unrelated ping arrives.
      if (tasksRefetchRequestRef.current !== requestId) return;
      if (
        tasksWriteVersionRef.current !== writeVersionAtStart ||
        pendingTaskMutationsRef.current.size > 0
      ) {
        // In the common case the mutation has ALREADY settled by the time
        // this response lands, so its flush already ran and will never run
        // again — re-run right here instead of waiting for a future mutation
        // that may never come. Only park the flag while a write is genuinely
        // still open.
        if (pendingTaskMutationsRef.current.size === 0) {
          tasksRefetchDirtyRef.current = false;
          refetchTasksRef.current?.();
          return;
        }
        tasksRefetchDirtyRef.current = true;
        return;
      }
      tasksRefetchDirtyRef.current = false;
      updateTasks((prev) => mergeRefetchedTasks(prev, data.tasks as TaskRow[], recentTaskWritesRef));
      void loadUnreadAssignedTaskIds();
    } catch {
      // ignore; the next ping or reconnect retries
    }
  }, [loadUnreadAssignedTaskIds]);

  useEffect(() => {
    refetchTasksRef.current = () => void refetchTasks();
  }, [refetchTasks]);

  // Re-run an update that was dropped because a local write was in flight, so
  // we never trade "UI reverts" for "UI silently stale". Called when a
  // mutation settles.
  const flushDeferredTaskRefetch = useCallback(() => {
    if (pendingTaskMutationsRef.current.size > 0) return;
    if (!tasksRefetchDirtyRef.current) return;
    tasksRefetchDirtyRef.current = false;
    void refetchTasks();
  }, [refetchTasks]);

  const loadOverview = useCallback(async (background = false) => {
    if (!isManager) return;
    if (background) setOverviewRefreshing(true);
    else setOverviewLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.from) params.set("from", dateRange.from);
      if (dateRange.to) params.set("to", dateRange.to);
      const query = params.toString();
      const response = await fetch(
        `/api/tasks/overview${query ? `?${query}` : ""}`,
        { cache: "no-store" }
      );
      const data = (await response.json().catch(() => null)) as
        | OverviewSnapshot
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(data && "error" in data ? data.error : "Could not load workload overview.");
      }
      setOverviewSnapshot(data as OverviewSnapshot);
      setOverviewError(null);
    } catch (loadError) {
      setOverviewError(
        loadError instanceof Error ? loadError.message : "Could not load workload overview."
      );
    } finally {
      if (background) setOverviewRefreshing(false);
      else setOverviewLoading(false);
    }
  }, [dateRange.from, dateRange.to, isManager]);

  const changeAssignmentQueueMember = useCallback(
    async (email: string, enabled: boolean) => {
      setOverviewSnapshot((current) =>
        current
          ? {
              ...current,
              csRows: current.csRows.map((row) =>
                row.email === email ? { ...row, queueEnabled: enabled } : row
              ),
            }
          : current
      );

      const response = await fetch("/api/tasks/assignment-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, enabled }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        const message = data?.error ?? "Could not update assignment queue.";
        setOverviewError(message);
        void loadOverview(true);
        throw new Error(message);
      }

      setOverviewNotice(enabled ? "CS added to assignment queue." : "CS removed from assignment queue.");
      setOverviewError(null);
      void loadOverview(true);
    },
    [loadOverview]
  );

  useEffect(() => {
    if (!isManager || view !== "overview") return;
    const rangeKey = `${dateRange.from}|${dateRange.to}`;
    if (overviewSnapshot && overviewRangeKeyRef.current === rangeKey) return;
    overviewRangeKeyRef.current = rangeKey;
    const timer = window.setTimeout(
      () => void loadOverview(Boolean(overviewSnapshot)),
      0
    );
    return () => window.clearTimeout(timer);
  }, [dateRange.from, dateRange.to, isManager, loadOverview, overviewSnapshot, view]);

  useEffect(() => {
    if (!isManager || view !== "overview" || !overviewSnapshot) return;
    const timer = window.setInterval(() => void loadOverview(true), SLA_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isManager, loadOverview, overviewSnapshot, view]);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refetchTasks();
        void reloadCategories();
        if (isManager && view === "overview") void loadOverview(true);
      }, 300);
    };
    const channel = sb
      .channel(TASKS_TOPIC)
      .on("broadcast", { event: "changed" }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void refetchTasks();
          if (isManager && view === "overview") void loadOverview(true);
        }
      });
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [isManager, loadOverview, refetchTasks, view]);

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

  const assigneeLabelByEmail = useMemo(
    () =>
      new Map(
        assignees.map((assignee) => [
          assignee.email,
          assignee.name?.trim() || formatEmailAsName(assignee.email),
        ])
      ),
    [assignees]
  );

  // Names-only map (real account names, no email fallback baked in) so search
  // rows resolve to a name via personLabel, falling back to a name-ish email.
  const searchLabelByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of assignees) {
      const name = person.name?.trim();
      if (name) map.set(person.email, name);
    }
    return map;
  }, [assignees]);

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

    const selectedAgentEmails = new Set(agents.map((agent) => agent.email));
    return [...stats.values()].filter(
      (stat) => stat.total > 0 || selectedAgentEmails.has(stat.key)
    );
  }, [agentChoices, agents, tasks, slaRules, now]);

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
  // Plain CS now see ALL their agent's tasks (no My/Group toggle); the assignee
  // filter (defaulting to themselves) narrows it instead.
  const scopedTasks = tasks;

  // Non-admins only fetch their own scope, so derive the Agent/Assignee filter
  // options from the tasks they can see. This scopes the dropdowns to their own
  // agents + team and never exposes the full company lists.
  const isAgentOrAssistant = !isManager && canManageOwnAgentGroup;
  // Agent/admin get the oversight order; plain CS keep the work-queue order.
  const managerView = isManager || isAgentOrAssistant;
  const scopedAgentStats = useMemo(() => {
    if (isManager) return agentStats;
    const inScope = new Set(tasks.map((task) => task.agent_email ?? NO_AGENT));
    return agentStats.filter((stat) => inScope.has(stat.key));
  }, [isManager, agentStats, tasks]);
  const filterAssignees = useMemo(() => {
    if (isManager) return assignees;
    const inScope = new Set<string>();
    for (const task of tasks) {
      for (const email of task.assignees) inScope.add(email);
    }
    return assignees.filter((assignee) => inScope.has(assignee.email));
  }, [isManager, assignees, tasks]);

  // Which filters make sense for the current view + role. Hidden filters are also
  // forced inert here so a stale value can't silently filter a view that hides it.
  //  - Agent (customer agent_email): admin, or an agent/assistant covering >1 agent.
  //  - Assignee: admin + agent/assistant (scoped to their team), or plain-CS Group
  //    tasks filter; never on Backlog.
  //  - Status: List only (Board columns already are statuses; Backlog is all backlog).
  //  - Category: hidden for plain CS users.
  const showAgentFilter = scopedAgentStats.length > 0;
  const showAssigneeFilter = isManager || isAgentOrAssistant;
  const showInlineAssigneeFilter = shouldLimitPlainCsTasks;
  const enableAssigneeFilter = showAssigneeFilter || showInlineAssigneeFilter;
  const effectivePresets = useMemo(
    () =>
      isManager ? presets.filter((preset) => preset === "overdue") : presets,
    [isManager, presets]
  );
  const showStatusFilter = view === "list";
  const showPriorityFilter = true;
  const showCategoryFilter = !shouldLimitPlainCsTasks;
  const visibleTaskListColumnConfig = useMemo(
    () => visibleTaskListColumns(hiddenTaskListColumnKeys, taskListColumnConfig),
    [hiddenTaskListColumnKeys, taskListColumnConfig]
  );
  // Admin-level visibility for the Create dialog + Detail drawer — computed
  // straight from the raw column config, deliberately NOT from
  // visibleTaskListColumnConfig above (that one also folds in this specific
  // user's personal List/Board column-hide state via hiddenTaskListColumnKeys,
  // which must never affect whether a field can be created/edited).
  const configuredColumnKeys = useMemo(
    () =>
      new Set(
        taskLayoutColumns
          .filter((column) => !column.archived_at)
          .map((column) => column.key)
      ),
    [taskLayoutColumns]
  );
  const adminVisibleColumnKeys = useMemo(
    () =>
      new Set(
        taskLayoutColumns
          .filter((column) => !column.archived_at && !column.hidden_default)
          .map((column) => column.key)
      ),
    [taskLayoutColumns]
  );
  const requiredColumnKeys = useMemo(
    () =>
      new Set(
        taskLayoutColumns
          .filter((column) => column.required && !column.archived_at)
          .map((column) => column.key)
      ),
    [taskLayoutColumns]
  );
  // Label source for surfaces that don't get the per-user-filtered list —
  // same rule as configuredColumnKeys/adminVisibleColumnKeys above: built
  // from taskListColumnConfig (already resolves live label/position/pinned
  // over defaults), never from a second independent derivation, and never
  // from anything that folds in this user's personal List-view hide state.
  const columnByKey = useMemo(
    () => new Map(taskListColumnConfig.map((column) => [column.key, column])),
    [taskListColumnConfig]
  );
  const taskDetailColumns = useMemo(
    () =>
      taskLayoutColumns.filter(
        (column) =>
          column.show_in_detail &&
          !column.is_system &&
          !column.archived_at &&
          !column.hidden_default
      ),
    [taskLayoutColumns]
  );

  const visibleTasks = useMemo(
    () =>
      filterTasks(scopedTasks, {
        query: "",
        agent: showAgentFilter ? agentFilter : [],
        assignee: enableAssigneeFilter ? assigneeFilter : [],
        quick: effectivePresets,
        category: showCategoryFilter ? categoryFilter : [],
        status: showStatusFilter ? statusFilter : [],
        priority: showPriorityFilter ? priorityFilter : [],
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        currentEmail,
        overdueIds,
      }),
    [
      scopedTasks,
      agentFilter,
      assigneeFilter,
      effectivePresets,
      categoryFilter,
      statusFilter,
      priorityFilter,
      dateRange,
      showAgentFilter,
      enableAssigneeFilter,
      showStatusFilter,
      showPriorityFilter,
      showCategoryFilter,
      currentEmail,
      overdueIds,
    ]
  );
  const displayedResultCount = visibleTasks.length;
  const displayedTotalCount = tasks.length;
  const exportTaskIds = useMemo(
    () => visibleTasks.map((task) => task.id),
    [visibleTasks]
  );
  const exportColumnKeys = useMemo(
    () => visibleTaskListColumnConfig.map((column) => column.key),
    [visibleTaskListColumnConfig]
  );
  // POST the visible ids in the body instead of a GET href: a few hundred task
  // ids in the query string overflow the server's max header/URL size and fail
  // with HTTP 431 ("Request Header Fields Too Large").
  const [exporting, setExporting] = useState(false);
  const exportVisibleTasks = useCallback(async () => {
    setExporting(true);
    try {
      const response = await fetch("/api/tasks/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: exportColumnKeys, ids: exportTaskIds }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(data?.error ?? "Could not export tasks.");
        return;
      }
      await downloadResponseFile(response, "health-tasks.xlsx");
    } catch {
      window.alert("Could not export tasks.");
    } finally {
      setExporting(false);
    }
  }, [exportColumnKeys, exportTaskIds]);

  const openTask = tasks.find((t) => t.id === openId) ?? null;

  function openTaskById(id: string) {
    markNewAssignedTaskSeen(id);
    const task = tasks.find((t) => t.id === id) ?? null;
    if (task && overdueIds.has(id)) {
      setOpenId(null);
      setOpenCommentId(null);
      setUnlockingTaskId(id);
      writeTaskDeepLink(null);
      return;
    }
    setOpenId(id);
    setOpenCommentId(null);
    writeTaskDeepLink(null);
  }
  function closeTask() {
    setOpenId(null);
    setOpenCommentId(null);
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
      flushDeferredTaskRefetch();
    };
  }

  // Every write to `tasks` — optimistic or confirmed — goes through this so a
  // stale in-flight refetch can never clobber a more-recent one. It also
  // stamps recentTaskWritesRef for every task that actually changed, which
  // refetchTasks uses to protect against the narrower race the version/pending
  // checks alone don't fully close (see the comment on that ref above).
  function updateTasks(updater: (prev: TaskRow[]) => TaskRow[]) {
    tasksWriteVersionRef.current += 1;
    setTasks((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        taskRowsRef.current = new Map(next.map((task) => [task.id, task]));
        const prevById = new Map(prev.map((t) => [t.id, t]));
        const now = Date.now();
        for (const task of next) {
          if (prevById.get(task.id) !== task) {
            recentTaskWritesRef.current.set(task.id, now);
          }
        }
      }
      return next;
    });
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

  function capabilitiesFor(task: TaskRow) {
    return resolveTaskCapabilities(
      { email: currentEmail, isManager, isWorker: true },
      { assignee_email: task.assignees[0] ?? task.assignee_email },
      {
        isAssignee: task.assignees.includes(currentEmail),
        isAgentOwner: isAgentOwnerOrAssistantOf(task.agent_email),
        isAgentMember: isAgentTeamMemberOf(task.agent_email),
        isReporter: task.reporter_email === currentEmail,
        isParticipant: Boolean(task.viewer_is_participant),
      }
    );
  }

  function reviewDoneTask(id: string, reviewed: boolean) {
    void patchTask(id, { done_reviewed: reviewed });
  }

  function applyLocalTask(task: TaskRow) {
    taskRowsRef.current.set(task.id, task);
    updateTasks((current) =>
      current.map((candidate) => (candidate.id === task.id ? task : candidate))
    );
  }

  async function fetchCanonicalTask(id: string): Promise<TaskRow | null> {
    try {
      const response = await fetch(`/api/tasks/${id}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { task?: TaskRow };
      return data.task?.id === id ? data.task : null;
    } catch {
      return null;
    }
  }

  function rebasePendingTaskPatches(id: string, state: TaskMutationState) {
    let next = state.confirmed;
    for (const pending of state.pending) {
      next = {
        ...next,
        ...buildOptimisticTaskPatch(pending.patch, currentEmail, next),
      } as TaskRow;
    }
    applyLocalTask(next);
    if (state.pending.length === 0) {
      taskMutationStatesRef.current.delete(id);
    }
  }

  function patchTask(id: string, patch: Record<string, unknown>): Promise<void> {
    const before = taskRowsRef.current.get(id) ?? tasks.find((task) => task.id === id) ?? null;
    if (!before) {
      setError("Task is no longer available. Refresh and try again.");
      return Promise.resolve();
    }

    const state =
      taskMutationStatesRef.current.get(id) ??
      ({
        confirmed: before,
        pending: [],
        nextSequence: 0,
        tail: Promise.resolve(),
      } satisfies TaskMutationState);
    taskMutationStatesRef.current.set(id, state);
    const sequence = state.nextSequence++;
    state.pending.push({ sequence, patch });

    const optimistic = {
      ...before,
      ...buildOptimisticTaskPatch(patch, currentEmail, before),
    } as TaskRow;
    applyLocalTask(optimistic);
    const finishPendingMutation = beginTaskMutation(id);

    const operation = state.tail
      .then(async () => {
        let response: Response;
        try {
          response = await fetch(`/api/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...patch,
              expected_updated_at: state.confirmed.updated_at,
            }),
          });
        } catch {
          setError("Mất kết nối — không lưu được thay đổi.");
          return;
        }

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          if (response.status === 409) {
            const canonical = await fetchCanonicalTask(id);
            if (canonical) {
              state.confirmed = canonical;
              setError("Task đã thay đổi ở nơi khác; đã tải lại bản ghi chuẩn.");
            } else {
              setError("Task đã thay đổi ở nơi khác; hãy tải lại để tiếp tục.");
            }
          } else {
            setError(data?.error ?? "Không cập nhật được task.");
          }
          return;
        }

        const data = (await response.json()) as { task?: TaskRow };
        if (data.task?.id === id) {
          state.confirmed = data.task;
        } else {
          setError("Server không trả về task sau khi cập nhật.");
        }
      })
      .catch(() => {
        setError("Không cập nhật được task.");
      })
      .finally(() => {
        state.pending = state.pending.filter((pending) => pending.sequence !== sequence);
        rebasePendingTaskPatches(id, state);
        finishPendingMutation();
      });

    state.tail = operation;
    return operation;
  }

  function moveTask(id: string, change: { status: TaskStatus; position: number }) {
    void patchTask(id, change);
  }

  async function submitOverdueUnlock(reason: string): Promise<boolean> {
    const id = unlockingTaskId;
    if (!id) return false;
    const before = taskRowsRef.current.get(id) ?? tasks.find((task) => task.id === id);
    if (!before) {
      setError("Task is no longer available. Refresh and try again.");
      return false;
    }
    const finishPendingMutation = beginTaskMutation(id);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}/overdue-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, expected_updated_at: before.updated_at }),
      });
    } catch {
      finishPendingMutation();
      setError("Connection lost — could not unlock the overdue task.");
      return false;
    }
    if (!res.ok) {
      finishPendingMutation();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 409) {
        const canonical = await fetchCanonicalTask(id);
        if (canonical) replaceTask(canonical);
      }
      setError(data?.error ?? "Could not unlock the overdue task.");
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
    const before = taskRowsRef.current.get(id) ?? tasks.find((task) => task.id === id);
    if (!before) {
      setError("Task is no longer available. Refresh and try again.");
      return false;
    }
    const finishPendingMutation = beginTaskMutation(id);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, expected_updated_at: before.updated_at }),
      });
    } catch {
      finishPendingMutation();
      setError("Connection lost — could not reopen the task.");
      return false;
    }
    if (!res.ok) {
      finishPendingMutation();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 409) {
        const canonical = await fetchCanonicalTask(id);
        if (canonical) replaceTask(canonical);
      }
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, expected_updated_at: before.updated_at }),
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
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 409) {
        const canonical = await fetchCanonicalTask(id);
        if (canonical) {
          replaceTask(canonical);
        } else {
          updateTasks((cur) => cur.map((task) => (task.id === id ? before : task)));
        }
      } else {
        updateTasks((cur) => cur.map((task) => (task.id === id ? before : task)));
      }
      setError(data?.error ?? "Không cập nhật được assignee.");
      return;
    }

    const data = await res.json();
    replaceTask(data.task as TaskRow);
    finishPendingMutation();
  }

  async function assignOverviewTask(
    taskId: string,
    email: string,
    expectedUpdatedAt: string | null
  ) {
    if (!overviewSnapshot) return;
    const before = overviewSnapshot;
    setAssigningOverviewTaskId(taskId);
    setOverviewSnapshot((current) =>
      current ? optimisticallyAssignOverviewTask(current, taskId, email) : current
    );

    try {
      const response = await fetch(`/api/tasks/${taskId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, expectedUpdatedAt }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setOverviewSnapshot(before);
        await loadOverview(true);
        setOverviewNotice(
          response.status === 409
            ? "This task changed while you were reviewing it. The dashboard has been refreshed."
            : data?.error ?? "Could not assign this task."
        );
        return;
      }
      setOverviewError(null);
      await loadOverview(true);
      setOverviewNotice(
        `Task assigned to ${assigneeLabelByEmail.get(email) ?? formatEmailAsName(email)}.`
      );
    } catch {
      setOverviewSnapshot(before);
      setOverviewError("Connection lost — the assignment was not confirmed.");
    } finally {
      setAssigningOverviewTaskId(null);
    }
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
    const before = taskRowsRef.current.get(id) ?? tasks.find((task) => task.id === id);
    if (!before) return;
    const beforeIndex = tasks.findIndex((task) => task.id === id);
    const finishPendingMutation = beginTaskMutation(id);
    updateTasks((cur) => cur.filter((t) => t.id !== id));
    setOpenId(null);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_updated_at: before.updated_at }),
      });
    } catch {
      finishPendingMutation();
      updateTasks((current) => {
        if (current.some((task) => task.id === id)) return current;
        const restored = [...current];
        restored.splice(Math.min(Math.max(beforeIndex, 0), restored.length), 0, before);
        return restored;
      });
      setError("Mất kết nối — không xoá được task.");
      return;
    }
    if (!res.ok) {
      finishPendingMutation();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 409) {
        const canonical = await fetchCanonicalTask(id);
        if (canonical?.archived_at) {
          updateTasks((current) => current.filter((task) => task.id !== id));
        } else if (canonical) {
          replaceTask(canonical);
        } else {
          updateTasks((current) => {
            if (current.some((task) => task.id === id)) return current;
            const restored = [...current];
            restored.splice(Math.min(Math.max(beforeIndex, 0), restored.length), 0, before);
            return restored;
          });
        }
      } else {
        updateTasks((current) => {
          if (current.some((task) => task.id === id)) return current;
          const restored = [...current];
          restored.splice(Math.min(Math.max(beforeIndex, 0), restored.length), 0, before);
          return restored;
        });
      }
      setError(data?.error ?? "Không xoá được task.");
      return;
    }
    finishPendingMutation();
  }

  function clearAllFilters() {
    setAgentFilter([]);
    setAssigneeFilter([]);
    setPresets([]);
    setCategoryFilter([]);
    setStatusFilter([]);
    setPriorityFilter([]);
    setShowTeamTasks(false);
    setDateRange(defaultDateRange);
  }

  function toggleTaskListColumn(key: TaskListColumnKey) {
    setHiddenTaskListColumnKeys((current) => {
      const next = toggleHiddenTaskListColumn(
        current,
        key,
        TASK_LIST_LOCKED_COLUMN_KEYS
      ) as Set<TaskListColumnKey>;
      writeHiddenTaskListColumns(browserStorage(), next);
      void saveTaskTableLayout(next);
      return next;
    });
  }

  async function saveTaskTableLayout(hiddenKeys: ReadonlySet<TaskListColumnKey>) {
    const layout = serializeLayout(
      taskLayoutColumns.map((column) => ({
        ...column,
        width: null,
        hidden:
          !column.pinned &&
          !TASK_LIST_LOCKED_COLUMN_KEYS.has(column.key) &&
          hiddenKeys.has(column.key as TaskListColumnKey),
      }))
    );
    const response = await fetch("/api/config/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "cs", layout }),
    }).catch(() => null);
    if (!response?.ok) {
      const data = (await response?.json().catch(() => null)) as
        | { error?: string }
        | null
        | undefined;
      setError(data?.error ?? "Không lưu được cấu hình bảng.");
    }
  }

  function saveDefaultDateRange(nextDefault: TaskDateRangeDefault) {
    setDateRangeDefault(nextDefault);
    writeTaskDateRangeDefault(nextDefault);
  }

  const openTaskCapabilities = openTask ? capabilitiesFor(openTask) : null;
  const canAssignOpen = Boolean(openTaskCapabilities?.canAssign);
  const canEditOpen = Boolean(openTaskCapabilities?.canEditContent);
  const canDeleteOpen = Boolean(openTaskCapabilities?.canDelete);
  const canViewOpenNonCommentDetail = Boolean(
    openTask && (isManager || isAgentOwnerOrAssistantOf(openTask.agent_email))
  );
  const canCreateTasks = isManager || canManageOwnAgentGroup;
  const frameView = view === "list";
  const shellClassName = frameView
    ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]"
    : "flex min-h-full min-w-0 flex-col bg-[#f7f9fc] text-[#172b4d]";
  const overviewHeader = view === "overview" && isManager;
  const pageTitle = overviewHeader ? "CS Workload Overview" : boardTitle;

  return (
    <div className={shellClassName}>
      {exporting ? (
        <div className="notif-toast fixed bottom-4 right-4 z-[200] flex items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-4 py-3 text-sm font-bold text-[#172b4d] shadow-xl">
          <Loader2 className="h-4 w-4 animate-spin text-[#0c66e4]" />
          Đang xuất Excel…
        </div>
      ) : null}
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold leading-tight tracking-normal text-[#172b4d]">
                {pageTitle}
              </h1>
            </div>

            {!overviewHeader ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isManager && (
                  <>
                    <button
                      type="button"
                      onClick={() => setManagingSlaRules(true)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                    >
                      <Clock className="h-4 w-4" />
                      SLA Times
                    </button>
                  </>
                )}
                {canExport ? (
                  <ExportMenu onExport={exportVisibleTasks} />
                ) : null}
                {canCreateTasks && (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc]"
                  >
                    <Plus className="h-4 w-4" />
                    New task
                  </button>
                )}
              </div>
            ) : null}
          </header>

          <TaskToolbar
            view={view}
            onViewChange={setView}
            isManager={isManager}
            overviewRefreshing={overviewRefreshing}
            onOverviewRefresh={() => void loadOverview(Boolean(overviewSnapshot))}
            labelByEmail={searchLabelByEmail}
            agentStats={scopedAgentStats}
            agentFilter={agentFilter}
            onAgentFilter={setAgentFilter}
            assignees={filterAssignees}
            assigneeFilter={assigneeFilter}
            onAssigneeFilter={setAssigneeFilter}
            presets={effectivePresets}
            onPresets={setPresets}
            category={categoryFilter}
            onCategory={setCategoryFilter}
            status={statusFilter}
            onStatus={setStatusFilter}
            priority={priorityFilter}
            onPriority={setPriorityFilter}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            defaultDateRange={defaultDateRange}
            onDateRange={setDateRange}
            onDefaultDateRange={saveDefaultDateRange}
            showAgent={showAgentFilter}
            showAssignee={showAssigneeFilter}
            showInlineAssignee={showInlineAssigneeFilter}
            showStatus={showStatusFilter}
            showCategory={showCategoryFilter}
            showTeamTasksToggle={false}
            teamTasksEnabled={showTeamTasks}
            onTeamTasksEnabledChange={setShowTeamTasks}
            categories={categories}
            resultCount={displayedResultCount}
            totalCount={displayedTotalCount}
            onClearAll={clearAllFilters}
            listColumns={taskListColumnConfig}
            hiddenListColumnKeys={hiddenTaskListColumnKeys}
            onToggleListColumn={toggleTaskListColumn}
          />
        </div>
      </div>

      {view === "board" && (
        <KanbanBoard
          tasks={visibleTasks}
          onOpen={openTaskById}
          onMove={moveTask}
          canMoveTask={(task) => capabilitiesFor(task).canChangeStatus}
          canReviewDoneTask={(task) =>
            (task.status === "done" || task.status === "cancel") &&
            capabilitiesFor(task).canReviewQC
          }
          onReviewDone={reviewDoneTask}
          categories={categories}
          assigneeLabelByEmail={assigneeLabelByEmail}
          newAssignedTaskIds={displayNewAssignedTaskIds}
          useAssigneeTodoClock={shouldLimitPlainCsTasks && !showTeamTasks}
          rules={slaRules}
          now={now}
          managerView={managerView}
          onUnlockOverdue={setUnlockingTaskId}
          onReopenRequest={setReopeningTaskId}
          visibleColumnKeys={adminVisibleColumnKeys}
        />
      )}

      {view === "list" && (
        <TaskListView
          tasks={visibleTasks}
          categories={categories}
          assignees={assignees}
          agents={agents}
          isManager={isManager}
          myAssistantAgents={myAssistantAgents}
          agentMembersByAgent={agentMembersByAgent}
          currentEmail={currentEmail}
          onOpen={openTaskById}
          onPatch={patchTask}
          onReviewDone={reviewDoneTask}
          onAssigneeChange={changeAssignee}
          overdueIds={overdueIds}
          newAssignedTaskIds={displayNewAssignedTaskIds}
          rules={slaRules}
          now={now}
          managerView={managerView}
          onUnlockOverdue={setUnlockingTaskId}
          onReopenRequest={setReopeningTaskId}
          visibleColumns={visibleTaskListColumnConfig}
          tableColumnOptions={tableColumnOptions}
        />
      )}

      {view === "overview" && isManager && (
        <CSWorkloadOverview
          snapshot={overviewSnapshot}
          loading={overviewLoading}
          error={overviewError}
          notice={overviewNotice}
          onRefresh={() => void loadOverview(Boolean(overviewSnapshot))}
          onOpenTask={openTaskById}
          onAssign={assignOverviewTask}
          onQueueMemberChange={changeAssignmentQueueMember}
          assigningTaskId={assigningOverviewTaskId}
          selectedTaskId={selectedOverviewTaskId}
          onSelectTask={setSelectedOverviewTaskId}
        />
      )}

      {creating && canCreateTasks ? (
        <NewTaskDialog
          open={creating}
          isManager={isManager}
          currentEmail={currentEmail}
          myAssistantAgents={myAssistantAgents}
          assignees={assignees}
          agents={agents}
          agentCandidates={agentCandidates}
          myAgents={myAgents}
          agentMembersByAgent={agentMembersByAgent}
          categories={categories}
          detailColumns={taskDetailColumns}
          tableColumnOptions={tableColumnOptions}
          configuredColumnKeys={configuredColumnKeys}
          visibleColumnKeys={adminVisibleColumnKeys}
          requiredColumnKeys={requiredColumnKeys}
          columnByKey={columnByKey}
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
          canChangeStatus={Boolean(openTaskCapabilities?.canChangeStatus)}
          isOverdue={overdueIds.has(openTask.id)}
          onReopenRequest={() => setReopeningTaskId(openTask.id)}
          onUnlockOverdueRequest={() => setUnlockingTaskId(openTask.id)}
          onParentUpdatedAt={(updatedAt) =>
            updateTasks((current) =>
              current.map((task) =>
                task.id === openTask.id ? { ...task, updated_at: updatedAt } : task
              )
            )
          }
          assignees={assignees}
          agentMembersByAgent={agentMembersByAgent}
          agents={agents}
          mentionMembers={mentionMembers}
          categories={categories}
          detailColumns={taskDetailColumns}
          tableColumnOptions={tableColumnOptions}
          configuredColumnKeys={configuredColumnKeys}
          visibleColumnKeys={adminVisibleColumnKeys}
          requiredColumnKeys={requiredColumnKeys}
          columnByKey={columnByKey}
          currentEmail={currentEmail}
          canReviewDone={
            (openTask.status === "done" || openTask.status === "cancel") &&
            Boolean(openTaskCapabilities?.canReviewQC)
          }
          canViewNonCommentDetail={canViewOpenNonCommentDetail}
          highlightCommentId={openCommentId}
          onClose={closeTask}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onReviewDone={(reviewed) => reviewDoneTask(openTask.id, reviewed)}
          onAssigneeChange={(email, assigned) =>
            changeAssignee(openTask.id, email, assigned)
          }
          onDelete={() => deleteTask(openTask.id)}
        />
      )}

      <SlaRulesModal
        open={managingSlaRules}
        categories={categories}
        rules={slaRules}
        onRulesChange={setSlaRules}
        onClose={() => setManagingSlaRules(false)}
      />

      <ReasonModal
        open={unlockingTaskId !== null}
        title="Unlock overdue task"
        description="Enter a reason to keep working this overdue task in In Progress."
        placeholder="Reason for the delay..."
        submitLabel="Unlock"
        accentColor="#de350b"
        onClose={() => setUnlockingTaskId(null)}
        onSubmit={submitOverdueUnlock}
      />

      <ReasonModal
        open={reopeningTaskId !== null}
        title="Reopen task"
        description="This task is Done/Cancelled. Enter a reason to move it back to In Progress."
        placeholder="Reason for reopening..."
        submitLabel="Reopen"
        accentColor="#0c66e4"
        onClose={() => setReopeningTaskId(null)}
        onSubmit={submitReopen}
      />

      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
    </div>
  );
}

async function downloadResponseFile(response: Response, fallback: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const disposition = response.headers.get("content-disposition");
  const match = disposition ? /filename="?([^"]+)"?/.exec(disposition) : null;
  link.download = match?.[1] ?? fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ExportMenu({ onExport }: { onExport: () => void }) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] ${
          isOpen ? "border-[#0c66e4] text-[#0c66e4]" : "border-[#d8dee8]"
        }`}
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className="h-4 w-4 text-[#6b778c]" />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              role="menu"
              className="dashboard-filter-menu z-[140] w-[min(17rem,calc(100vw-1rem))] overflow-hidden p-1.5"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onExport();
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-[#172b4d] transition hover:bg-[#f4f5f7]"
              >
                <Download className="h-4 w-4 text-[#0c66e4]" />
                Export visible data
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function formatAgentLabel(agent: TaskAgent) {
  return agent.name?.trim() || formatEmailAsName(agent.email);
}

function optimisticElapsedSeconds(startIso: string | null | undefined, nowIso: string): number {
  if (!startIso) return 0;
  return Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(startIso).getTime()) / 1000));
}

function optimisticBankWaitingSeconds(before: TaskRow, nowIso: string): number {
  const elapsed = before.waiting_started_at
    ? optimisticElapsedSeconds(before.waiting_started_at, nowIso)
    : 0;
  return Math.max(1, (before.waiting_seconds ?? 0) + elapsed);
}

// How long a task stays "protected" from a background refetch after any local
// write to it. Generous on purpose: it only matters while genuinely racing a
// slow request, and being a bit too long just means a rare late-arriving
// server correction is delayed slightly rather than a card flashing.
const RECENT_WRITE_COOLDOWN_MS = 3000;

// Applies a fresh full-list fetch, but for any task written to locally within
// the cooldown window, keeps the CURRENT local version instead of the fetched
// one. Prunes expired entries out of `recentWrites` as it goes so the map
// doesn't grow unbounded over a long session.
function mergeRefetchedTasks(
  prev: TaskRow[],
  fetched: TaskRow[],
  recentWrites: { current: Map<string, number> }
): TaskRow[] {
  const now = Date.now();
  for (const [id, writtenAt] of recentWrites.current) {
    if (now - writtenAt >= RECENT_WRITE_COOLDOWN_MS) recentWrites.current.delete(id);
  }
  if (recentWrites.current.size === 0) return fetched;

  const prevById = new Map(prev.map((t) => [t.id, t]));
  return fetched.map((task) => {
    if (!recentWrites.current.has(task.id)) return task;
    return prevById.get(task.id) ?? task;
  });
}

function buildOptimisticTaskPatch(
  patch: Record<string, unknown>,
  currentEmail: string,
  before?: TaskRow | null
): Record<string, unknown> {
  const optimistic = { ...patch };
  if (before && isPlainObject(optimistic.custom_values)) {
    optimistic.custom_values = {
      ...(isPlainObject(before.custom_values) ? before.custom_values : {}),
      ...optimistic.custom_values,
    };
  }

  // Mirror transitions.ts so the card doesn't flicker before the server
  // responds: bank the leaving stage's seconds into its accumulator for
  // history/KPI, clear its start, then open the new stage. Entering In Progress
  // clears stale active-overdue markers; SLA itself is disabled after Waiting.
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
    } else if (before.status === "waiting") {
      optimistic.waiting_seconds = optimisticBankWaitingSeconds(before, nowIso);
      optimistic.waiting_started_at = null;
    }

    if (optimistic.status === "todo") {
      optimistic.todo_started_at = nowIso;
    } else if (optimistic.status === "in_progress") {
      optimistic.in_progress_at = nowIso;
      optimistic.overdue_flagged_at = null;
      optimistic.overdue_reminded_at = null;
      optimistic.overdue_unlocked_at = null;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
