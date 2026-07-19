import type { TaskPriority, TaskStatus } from "./types";

export const OVERVIEW_STATUSES = ["free", "ok", "busy", "overloaded"] as const;
export type OverviewStatus = (typeof OVERVIEW_STATUSES)[number];

export const OVERVIEW_RISK_FLAGS = [
  "overdue",
  "todo_stuck",
  "waiting_stuck",
  "unknown_effort",
] as const;
export type OverviewRiskFlag = (typeof OVERVIEW_RISK_FLAGS)[number];

export const OVERVIEW_THRESHOLDS = {
  version: "v1",
  slaBusyMinutes: 8 * 60,
  slaOverloadedMinutes: 16 * 60,
  pressureBusy: 6,
  pressureOverloaded: 10,
} as const;

export type OverviewThresholds = typeof OVERVIEW_THRESHOLDS;

export type OverviewAccount = {
  email: string;
  name: string | null;
  isActive: boolean;
  canWork: boolean;
  isAdmin: boolean;
};

export type OverviewCategory = {
  id: string;
  name: string;
  color: string | null;
};

export type OverviewTaskInput = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: string | null;
  agent_email: string | null;
  assignee_email: string | null;
  todo_started_at: string | null;
  in_progress_at: string | null;
  waiting_started_at: string | null;
  last_activity_at: string | null;
  sla_minutes: number | null;
  overdue_count: number;
  in_progress_seconds: number;
  waiting_seconds: number;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type OverviewTaskSummary = {
  id: string;
  title: string;
  agentEmail: string | null;
  status: Extract<TaskStatus, "todo" | "in_progress" | "waiting">;
  priority: TaskPriority;
  createdAt: string;
  slaLoadMinutes: number;
  effectiveSlaMinutes: number;
  riskFlags: OverviewRiskFlag[];
  unknownEffort: boolean;
};

export type OverviewOpenStage = Extract<TaskStatus, "todo" | "in_progress" | "waiting">;
export type OverviewWorkMixStage =
  | "todo_overdue"
  | "todo"
  | "in_progress_overdue"
  | "in_progress"
  | "waiting";
export type OverviewPriorityCounts = Record<TaskPriority, number>;
export type OverviewStageCounts = Record<OverviewOpenStage, number>;
export type OverviewStagePriorityMatrix = Record<OverviewWorkMixStage, OverviewPriorityCounts>;

export type CsOverviewRow = {
  email: string;
  name: string | null;
  openCount: number;
  stageCounts: OverviewStageCounts;
  priorityCounts: OverviewPriorityCounts;
  slaLoadMinutes: number;
  priorityPressure: number;
  urgentHighCount: number;
  riskFlags: OverviewRiskFlag[];
  oldestOpenCreatedAt: string | null;
  oldestOpenAgeSeconds: number | null;
  lastTaskActivityAt: string | null;
  done24h: number;
  done7d: number;
  status: OverviewStatus;
  tasks: OverviewTaskSummary[];
};

export type OverviewAttentionBar = {
  key: OverviewRiskFlag;
  label: string;
  taskCount: number;
  affectedCsCount: number;
};

export type OverviewWorkMix = {
  stages: OverviewStageCounts;
  priorities: OverviewPriorityCounts;
  stagePriority: OverviewStagePriorityMatrix;
};

export type OverviewKpis = {
  csPoolCount: number;
  zeroLoadCsCount: number;
  openTaskCount: number;
  urgentHighTaskCount: number;
  needsAttentionTaskCount: number;
  unassignedTaskCount: number;
};

export type UnassignedOverviewTask = {
  id: string;
  title: string;
  agentEmail: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
  ageSeconds: number;
  effectiveSlaMinutes: number;
};

export type OutOfPoolOverviewException = {
  email: string;
  taskCount: number;
  taskIds: string[];
};

export type OverviewSnapshot = {
  generatedAt: string;
  thresholds: OverviewThresholds;
  kpis: OverviewKpis;
  attention: OverviewAttentionBar[];
  workMix: OverviewWorkMix;
  csRows: CsOverviewRow[];
  unassigned: UnassignedOverviewTask[];
  outOfPool: OutOfPoolOverviewException[];
};

export type RecommendationCandidate = {
  email: string;
  name: string | null;
  currentStatus: OverviewStatus;
  projectedStatus: OverviewStatus;
  openCount: number;
  projectedOpenCount: number;
  slaLoadMinutes: number;
  projectedSlaLoadMinutes: number;
  priorityPressure: number;
  projectedPriorityPressure: number;
  inProgressCount: number;
  urgentHighCount: number;
  riskFlags: OverviewRiskFlag[];
  why: string;
};
