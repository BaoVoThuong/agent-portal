import {
  effectiveSlaMinutes,
  isSlaActiveInProgress,
  slaRemainingSeconds,
  isTaskOverdue,
} from "./sla";
import type { TaskPriority, TaskSlaRule, TaskStatus } from "./types";
import {
  OVERVIEW_RISK_FLAGS,
  OVERVIEW_THRESHOLDS,
  type CsOverviewRow,
  type OverviewAccount,
  type OverviewAttentionBar,
  type OverviewKpis,
  type OverviewCategory,
  type OverviewPriorityCounts,
  type OverviewRiskFlag,
  type OverviewSnapshot,
  type OverviewStagePriorityMatrix,
  type OverviewStageCounts,
  type OverviewTaskInput,
  type OverviewTaskSummary,
  type OverviewThresholds,
  type OverviewWorkMixStage,
  type OutOfPoolOverviewException,
  type RecommendationCandidate,
  type UnassignedOverviewTask,
} from "./overview-types";

export const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const OPEN_STATUSES = ["todo", "in_progress", "waiting"] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];

const ATTENTION_LABELS: Record<OverviewRiskFlag, string> = {
  overdue: "Overdue in progress",
  todo_stuck: "Todo stuck",
  waiting_stuck: "Waiting stuck",
  unknown_effort: "Unknown effort",
};

export type OverviewInput = {
  now: Date;
  accounts: OverviewAccount[];
  categories: OverviewCategory[];
  taskAgents: string[];
  assistantEmails: string[];
  tasks: OverviewTaskInput[];
  assigneesByTask: Map<string, string[]>;
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[];
  reminderSettings: { todoHours: number; waitingHours: number };
};

type DerivedOpenTask = {
  task: OverviewTaskInput;
  assignees: string[];
  effectiveSlaMinutes: number;
  slaLoadMinutes: number;
  riskFlags: OverviewRiskFlag[];
  unknownEffort: boolean;
  summary: OverviewTaskSummary;
};

type PersonAccumulator = {
  account: OverviewAccount;
  tasks: OverviewTaskSummary[];
  stageCounts: OverviewStageCounts;
  priorityCounts: OverviewPriorityCounts;
  slaLoadMinutes: number;
  priorityPressure: number;
  riskFlags: Set<OverviewRiskFlag>;
  oldestOpenCreatedAt: string | null;
  oldestOpenAgeSeconds: number | null;
  lastTaskActivityAt: string | null;
  done24h: number;
  done7d: number;
};

function emptyStageCounts(): OverviewStageCounts {
  return { todo: 0, in_progress: 0, waiting: 0 };
}

function emptyPriorityCounts(): OverviewPriorityCounts {
  return { urgent: 0, high: 0, medium: 0, low: 0 };
}

function emptyStagePriorityMatrix(): OverviewStagePriorityMatrix {
  return {
    todo_overdue: emptyPriorityCounts(),
    todo: emptyPriorityCounts(),
    in_progress_overdue: emptyPriorityCounts(),
    in_progress: emptyPriorityCounts(),
    waiting: emptyPriorityCounts(),
  };
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageSeconds(value: string | null | undefined, now: Date): number | null {
  const parsed = timestamp(value);
  if (parsed === null) return null;
  return Math.max(0, Math.round((now.getTime() - parsed) / 1000));
}

function addFlag(flags: Set<OverviewRiskFlag>, flag: OverviewRiskFlag) {
  flags.add(flag);
}

function resolveAssignees(task: OverviewTaskInput, assigneesByTask: Map<string, string[]>): string[] {
  const junction = assigneesByTask.get(task.id) ?? [];
  if (junction.length > 0) return [...new Set(junction)];
  return task.assignee_email ? [task.assignee_email] : [];
}

function deriveOpenTask(
  task: OverviewTaskInput,
  assignees: string[],
  rules: OverviewInput["rules"],
  reminderSettings: OverviewInput["reminderSettings"],
  now: Date
): DerivedOpenTask | null {
  if (!OPEN_STATUSES.includes(task.status as OpenStatus)) return null;

  const effective = effectiveSlaMinutes(task, rules);
  const active = isSlaActiveInProgress(task);
  const flags = new Set<OverviewRiskFlag>();
  let unknownEffort = false;
  let loadMinutes = effective;

  if (task.status === "in_progress" && active) {
    const remainingSeconds = slaRemainingSeconds(task, rules, now);
    loadMinutes = Math.max(0, remainingSeconds / 60);
    if (isTaskOverdue(task, rules, now)) addFlag(flags, "overdue");
  } else if (task.status === "in_progress") {
    unknownEffort = true;
    addFlag(flags, "unknown_effort");
  } else if (task.status === "waiting") {
    loadMinutes = effective / 3;
  }

  if (task.status === "todo") {
    const age = ageSeconds(task.todo_started_at ?? task.created_at, now) ?? 0;
    if (age >= reminderSettings.todoHours * 3600) addFlag(flags, "todo_stuck");
  }
  if (task.status === "waiting") {
    const age = ageSeconds(task.waiting_started_at ?? task.created_at, now) ?? 0;
    if (age >= reminderSettings.waitingHours * 3600) addFlag(flags, "waiting_stuck");
  }

  const summary: OverviewTaskSummary = {
    id: task.id,
    title: task.title,
    agentEmail: task.agent_email,
    status: task.status as OpenStatus,
    priority: task.priority,
    createdAt: task.created_at,
    slaLoadMinutes: loadMinutes,
    effectiveSlaMinutes: effective,
    riskFlags: [...flags],
    unknownEffort,
  };

  return {
    task,
    assignees,
    effectiveSlaMinutes: effective,
    slaLoadMinutes: loadMinutes,
    riskFlags: [...flags],
    unknownEffort,
    summary,
  };
}

function statusLevel(status: "free" | "ok" | "busy" | "overloaded"): number {
  return { free: 0, ok: 1, busy: 2, overloaded: 3 }[status];
}

function levelStatus(level: number): "free" | "ok" | "busy" | "overloaded" {
  if (level >= 3) return "overloaded";
  if (level >= 2) return "busy";
  if (level >= 1) return "ok";
  return "free";
}

export function resolveOverviewStatus(
  openCount: number,
  slaLoadMinutes: number,
  priorityPressure: number,
  riskFlags: readonly OverviewRiskFlag[],
  thresholds: OverviewThresholds = OVERVIEW_THRESHOLDS
): OverviewSnapshot["csRows"][number]["status"] {
  if (openCount === 0) return "free";

  const riskLevel = riskFlags.some((flag) =>
    ["overdue", "todo_stuck", "waiting_stuck"].includes(flag)
  )
    ? 2
    : 0;
  const loadLevel =
    slaLoadMinutes >= thresholds.slaOverloadedMinutes
      ? 3
      : slaLoadMinutes >= thresholds.slaBusyMinutes
        ? 2
        : 1;
  const pressureLevel =
    priorityPressure >= thresholds.pressureOverloaded
      ? 3
      : priorityPressure >= thresholds.pressureBusy
        ? 2
        : 1;

  return levelStatus(Math.max(riskLevel, loadLevel, pressureLevel));
}

function createAccumulator(account: OverviewAccount): PersonAccumulator {
  return {
    account,
    tasks: [],
    stageCounts: emptyStageCounts(),
    priorityCounts: emptyPriorityCounts(),
    slaLoadMinutes: 0,
    priorityPressure: 0,
    riskFlags: new Set(),
    oldestOpenCreatedAt: null,
    oldestOpenAgeSeconds: null,
    lastTaskActivityAt: null,
    done24h: 0,
    done7d: 0,
  };
}

function addOpenTask(
  accumulator: PersonAccumulator,
  derived: DerivedOpenTask,
  now: Date
) {
  const { task, summary } = derived;
  accumulator.tasks.push(summary);
  accumulator.stageCounts[task.status as OpenStatus] += 1;
  accumulator.priorityCounts[task.priority] += 1;
  accumulator.slaLoadMinutes += derived.slaLoadMinutes;
  accumulator.priorityPressure += PRIORITY_WEIGHTS[task.priority];
  for (const flag of derived.riskFlags) accumulator.riskFlags.add(flag);

  const age = ageSeconds(task.created_at, now);
  if (age !== null && age > (accumulator.oldestOpenAgeSeconds ?? -1)) {
    accumulator.oldestOpenCreatedAt = task.created_at;
    accumulator.oldestOpenAgeSeconds = Math.max(
      accumulator.oldestOpenAgeSeconds ?? 0,
      age
    );
  }
  const activity = timestamp(task.last_activity_at);
  const current = timestamp(accumulator.lastTaskActivityAt);
  if (activity !== null && (current === null || activity > current)) {
    accumulator.lastTaskActivityAt = task.last_activity_at;
  }
}

function rowFromAccumulator(accumulator: PersonAccumulator, thresholds: OverviewThresholds): CsOverviewRow {
  const riskFlags = [...accumulator.riskFlags].sort(
    (a, b) => OVERVIEW_RISK_FLAGS.indexOf(a) - OVERVIEW_RISK_FLAGS.indexOf(b)
  );
  return {
    email: accumulator.account.email,
    name: accumulator.account.name,
    openCount: accumulator.tasks.length,
    stageCounts: accumulator.stageCounts,
    priorityCounts: accumulator.priorityCounts,
    slaLoadMinutes: Math.round(accumulator.slaLoadMinutes * 10) / 10,
    priorityPressure: accumulator.priorityPressure,
    urgentHighCount:
      accumulator.priorityCounts.urgent + accumulator.priorityCounts.high,
    riskFlags,
    oldestOpenCreatedAt: accumulator.oldestOpenCreatedAt,
    oldestOpenAgeSeconds: accumulator.oldestOpenAgeSeconds,
    lastTaskActivityAt: accumulator.lastTaskActivityAt,
    done24h: accumulator.done24h,
    done7d: accumulator.done7d,
    status: resolveOverviewStatus(
      accumulator.tasks.length,
      accumulator.slaLoadMinutes,
      accumulator.priorityPressure,
      riskFlags,
      thresholds
    ),
    tasks: [...accumulator.tasks].sort((a, b) => {
      const priority = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      return priority || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    }),
  };
}

function buildOutOfPool(
  tasks: DerivedOpenTask[],
  poolEmails: Set<string>
): OutOfPoolOverviewException[] {
  const byEmail = new Map<string, Set<string>>();
  for (const derived of tasks) {
    for (const email of derived.assignees) {
      if (poolEmails.has(email)) continue;
      const ids = byEmail.get(email) ?? new Set<string>();
      ids.add(derived.task.id);
      byEmail.set(email, ids);
    }
  }
  return [...byEmail.entries()]
    .map(([email, ids]) => ({ email, taskCount: ids.size, taskIds: [...ids] }))
    .sort((a, b) => b.taskCount - a.taskCount || a.email.localeCompare(b.email));
}

function buildAttention(
  tasks: DerivedOpenTask[],
  poolEmails: Set<string>
): OverviewAttentionBar[] {
  return OVERVIEW_RISK_FLAGS.map((key) => {
    const matching = tasks.filter((task) => task.riskFlags.includes(key));
    const affected = new Set<string>();
    for (const task of matching) {
      for (const email of task.assignees) if (poolEmails.has(email)) affected.add(email);
    }
    return {
      key,
      label: ATTENTION_LABELS[key],
      taskCount: matching.length,
      affectedCsCount: affected.size,
    };
  });
}

function workMixStageKey(derived: DerivedOpenTask): OverviewWorkMixStage {
  const stage = derived.task.status as OpenStatus;
  if (stage === "todo" && derived.riskFlags.includes("todo_stuck")) return "todo_overdue";
  if (stage === "in_progress" && derived.riskFlags.includes("overdue")) return "in_progress_overdue";
  return stage;
}

export function aggregateOverview(input: OverviewInput): OverviewSnapshot {
  const thresholds = OVERVIEW_THRESHOLDS;
  const pool = input.accounts.filter(
    (account) =>
      account.isActive &&
      account.canWork &&
      !account.isAdmin &&
      !input.taskAgents.includes(account.email) &&
      !input.assistantEmails.includes(account.email)
  );
  const poolEmails = new Set(pool.map((account) => account.email));
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const accumulators = new Map(pool.map((account) => [account.email, createAccumulator(account)]));
  const openDerived: DerivedOpenTask[] = [];
  const unassigned: UnassignedOverviewTask[] = [];
  const doneByEmail = new Map<string, { done24h: number; done7d: number }>();
  const sevenDaysAgo = input.now.getTime() - 7 * 24 * 3600_000;
  const dayAgo = input.now.getTime() - 24 * 3600_000;

  for (const task of input.tasks) {
    if (task.archived_at) continue;
    const assignees = resolveAssignees(task, input.assigneesByTask);
    if (task.status === "backlog" && assignees.length === 0) {
      const category = task.category_id ? categoryById.get(task.category_id) ?? null : null;
      unassigned.push({
        id: task.id,
        title: task.title,
        agentEmail: task.agent_email,
        categoryId: task.category_id,
        categoryName: category?.name ?? null,
        categoryColor: category?.color ?? null,
        priority: task.priority,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        ageSeconds: ageSeconds(task.created_at, input.now) ?? 0,
        effectiveSlaMinutes: effectiveSlaMinutes(task, input.rules),
      });
      continue;
    }

    const derived = deriveOpenTask(
      task,
      assignees,
      input.rules,
      input.reminderSettings,
      input.now
    );
    if (derived) {
      openDerived.push(derived);
      for (const email of assignees) {
        const accumulator = accumulators.get(email);
        if (accumulator) addOpenTask(accumulator, derived, input.now);
      }
      continue;
    }

    if (task.status !== "done") continue;
    const closedAt = timestamp(task.closed_at);
    if (closedAt === null || closedAt < sevenDaysAgo) continue;
    for (const email of assignees) {
      if (!poolEmails.has(email)) continue;
      const pulse = doneByEmail.get(email) ?? { done24h: 0, done7d: 0 };
      pulse.done7d += 1;
      if (closedAt >= dayAgo) pulse.done24h += 1;
      doneByEmail.set(email, pulse);
    }
  }

  for (const [email, pulse] of doneByEmail) {
    const accumulator = accumulators.get(email);
    if (accumulator) {
      accumulator.done24h = pulse.done24h;
      accumulator.done7d = pulse.done7d;
    }
  }

  const csRows = [...accumulators.values()]
    .map((accumulator) => rowFromAccumulator(accumulator, thresholds))
    .sort((a, b) => a.email.localeCompare(b.email));

  const stages = emptyStageCounts();
  const priorities = emptyPriorityCounts();
  const stagePriority = emptyStagePriorityMatrix();
  const urgentHighTaskIds = new Set<string>();
  const attentionTaskIds = new Set<string>();
  for (const derived of openDerived) {
    const stage = derived.task.status as OpenStatus;
    const matrixStage = workMixStageKey(derived);
    stages[stage] += 1;
    priorities[derived.task.priority] += 1;
    stagePriority[matrixStage][derived.task.priority] += 1;
    if (derived.task.priority === "urgent" || derived.task.priority === "high") {
      urgentHighTaskIds.add(derived.task.id);
    }
    if (derived.riskFlags.length > 0) attentionTaskIds.add(derived.task.id);
  }

  const kpis: OverviewKpis = {
    csPoolCount: csRows.length,
    zeroLoadCsCount: csRows.filter((row) => row.openCount === 0).length,
    openTaskCount: openDerived.length,
    urgentHighTaskCount: urgentHighTaskIds.size,
    needsAttentionTaskCount: attentionTaskIds.size,
    unassignedTaskCount: unassigned.length,
  };

  return {
    generatedAt: input.now.toISOString(),
    thresholds,
    kpis,
    attention: buildAttention(openDerived, poolEmails),
    workMix: { stages, priorities, stagePriority },
    csRows,
    unassigned: unassigned.sort(
      (a, b) =>
        PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority] ||
        a.ageSeconds - b.ageSeconds ||
        a.id.localeCompare(b.id)
    ),
    outOfPool: buildOutOfPool(openDerived, poolEmails),
  };
}

function projectedStatus(
  row: CsOverviewRow,
  projectedLoad: number,
  projectedPressure: number,
  thresholds: OverviewThresholds
) {
  return resolveOverviewStatus(
    row.openCount + 1,
    projectedLoad,
    projectedPressure,
    row.riskFlags,
    thresholds
  );
}

function explainCandidate(
  row: CsOverviewRow,
  task: UnassignedOverviewTask,
  projectedLoad: number,
  projectedPressure: number
): string {
  const parts: string[] = [];
  if (row.riskFlags.length === 0) parts.push("no risk flags");
  else parts.push(`${row.riskFlags.length} risk flag${row.riskFlags.length === 1 ? "" : "s"}`);
  if (task.priority === "urgent" || task.priority === "high") {
    parts.push(`${row.stageCounts.in_progress} in progress`);
    parts.push(`${row.priorityPressure} current pressure`);
  } else {
    parts.push(`${Math.round(projectedLoad)}m projected SLA load`);
    parts.push(`${projectedPressure} projected pressure`);
  }
  return parts.join("; ");
}

export function rankRecommendation(
  task: UnassignedOverviewTask,
  rows: CsOverviewRow[],
  thresholds: OverviewThresholds = OVERVIEW_THRESHOLDS
): RecommendationCandidate[] {
  const candidates = rows.map((row) => {
    const projectedLoad = row.slaLoadMinutes + task.effectiveSlaMinutes;
    const projectedPressure = row.priorityPressure + PRIORITY_WEIGHTS[task.priority];
    const candidate: RecommendationCandidate = {
      email: row.email,
      name: row.name,
      currentStatus: row.status,
      projectedStatus: projectedStatus(row, projectedLoad, projectedPressure, thresholds),
      openCount: row.openCount,
      projectedOpenCount: row.openCount + 1,
      slaLoadMinutes: row.slaLoadMinutes,
      projectedSlaLoadMinutes: projectedLoad,
      priorityPressure: row.priorityPressure,
      projectedPriorityPressure: projectedPressure,
      inProgressCount: row.stageCounts.in_progress,
      urgentHighCount: row.urgentHighCount,
      riskFlags: row.riskFlags,
      why: explainCandidate(row, task, projectedLoad, projectedPressure),
    };
    return candidate;
  });

  const statusRank = (status: string) => statusLevel(status as "free" | "ok" | "busy" | "overloaded");
  return candidates.sort((a, b) => {
    const urgent = task.priority === "urgent" || task.priority === "high";
    const keys = urgent
      ? [
          statusRank(a.projectedStatus) - statusRank(b.projectedStatus),
          a.inProgressCount - b.inProgressCount,
          a.projectedPriorityPressure - b.projectedPriorityPressure,
          a.projectedSlaLoadMinutes - b.projectedSlaLoadMinutes,
          a.projectedOpenCount - b.projectedOpenCount,
        ]
      : [
          statusRank(a.projectedStatus) - statusRank(b.projectedStatus),
          a.projectedSlaLoadMinutes - b.projectedSlaLoadMinutes,
          a.projectedOpenCount - b.projectedOpenCount,
          a.projectedPriorityPressure - b.projectedPriorityPressure,
        ];
    for (const key of keys) if (key !== 0) return key;
    return a.email.localeCompare(b.email);
  });
}

export function optimisticallyAssignOverviewTask(
  snapshot: OverviewSnapshot,
  taskId: string,
  email: string
): OverviewSnapshot {
  const task = snapshot.unassigned.find((item) => item.id === taskId);
  if (!task) return snapshot;
  const row = snapshot.csRows.find((item) => item.email === email);
  if (!row) return snapshot;

  const nextRows = snapshot.csRows.map((current) => {
    if (current.email !== email) return current;
    const nextStageCounts = { ...current.stageCounts, todo: current.stageCounts.todo + 1 };
    const nextPriorityCounts = {
      ...current.priorityCounts,
      [task.priority]: current.priorityCounts[task.priority] + 1,
    };
    const nextLoad = current.slaLoadMinutes + task.effectiveSlaMinutes;
    const nextPressure = current.priorityPressure + PRIORITY_WEIGHTS[task.priority];
    const nextFlags = [...current.riskFlags];
    const oldestOpenCreatedAt =
      !current.oldestOpenCreatedAt || task.createdAt < current.oldestOpenCreatedAt
        ? task.createdAt
        : current.oldestOpenCreatedAt;
    const oldestOpenAgeSeconds =
      ageSeconds(oldestOpenCreatedAt, new Date(snapshot.generatedAt)) ??
      current.oldestOpenAgeSeconds;
    return {
      ...current,
      openCount: current.openCount + 1,
      stageCounts: nextStageCounts,
      priorityCounts: nextPriorityCounts,
      slaLoadMinutes: nextLoad,
      priorityPressure: nextPressure,
      urgentHighCount:
        current.urgentHighCount +
        (task.priority === "urgent" || task.priority === "high" ? 1 : 0),
      oldestOpenCreatedAt,
      oldestOpenAgeSeconds,
      status: resolveOverviewStatus(
        current.openCount + 1,
        nextLoad,
        nextPressure,
        nextFlags,
        snapshot.thresholds
      ),
      tasks: [
        ...current.tasks,
        {
          id: task.id,
          title: task.title,
          agentEmail: task.agentEmail,
          status: "todo" as const,
          priority: task.priority,
          createdAt: task.createdAt,
          slaLoadMinutes: task.effectiveSlaMinutes,
          effectiveSlaMinutes: task.effectiveSlaMinutes,
          riskFlags: [],
          unknownEffort: false,
        },
      ],
    };
  });

  return {
    ...snapshot,
    kpis: {
      ...snapshot.kpis,
      openTaskCount: snapshot.kpis.openTaskCount + 1,
      urgentHighTaskCount:
        snapshot.kpis.urgentHighTaskCount +
        (task.priority === "urgent" || task.priority === "high" ? 1 : 0),
      unassignedTaskCount: Math.max(0, snapshot.kpis.unassignedTaskCount - 1),
    },
    workMix: {
      stages: { ...snapshot.workMix.stages, todo: snapshot.workMix.stages.todo + 1 },
      priorities: {
        ...snapshot.workMix.priorities,
        [task.priority]: snapshot.workMix.priorities[task.priority] + 1,
      },
      stagePriority: {
        ...snapshot.workMix.stagePriority,
        todo: {
          ...snapshot.workMix.stagePriority.todo,
          [task.priority]: snapshot.workMix.stagePriority.todo[task.priority] + 1,
        },
      },
    },
    csRows: nextRows,
    unassigned: snapshot.unassigned.filter((item) => item.id !== taskId),
  };
}

export function overviewTaskStatuses(): readonly TaskStatus[] {
  return OPEN_STATUSES;
}
