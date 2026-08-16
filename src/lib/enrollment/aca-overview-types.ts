import type { EnrollmentOption } from "./types";
import type { AcaPersonStageTiming, AttributedCycleRow } from "./aca-person-stage-timing";

export const ACA_OVERVIEW_THRESHOLD_DAYS = [1, 3, 7, 10] as const;
export type AcaOverviewThresholdDays = (typeof ACA_OVERVIEW_THRESHOLD_DAYS)[number];
export const ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS: AcaOverviewThresholdDays = 3;

export type AcaOverviewRecord = {
  id: string;
  display_number: string | null;
  client_name: string | null;
  stage_id: string | null;
  agent_email: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  due_date: string | null;
  qc_checked_at: string | null;
  created_at: string;
  closed_at: string | null;
  archived_at: string | null;
  stage_entered_at: string | null;
  stage_entered_source: "live" | "history_backfill" | "record_created" | null;
  last_work_activity_at: string | null;
  responsible_assigned_at: string | null;
  updated_at?: string | null;
};

export type AcaOverviewPerson = {
  email: string;
  name: string | null;
  canWork: boolean;
  queueEnabled: boolean;
};

export type AcaOverviewInput = {
  records: readonly AcaOverviewRecord[];
  stages: readonly EnrollmentOption[];
  people: readonly AcaOverviewPerson[];
  stageDwellMedianSeconds: ReadonlyMap<string, number | null>;
  thresholdDays: AcaOverviewThresholdDays;
  now: Date;
  period?: { from: string; to: string };
  attributedCycles?: readonly AttributedCycleRow[];
};

export type AcaOverviewScorecards = {
  totalTasks: number; done: number; open: number; terminated: number;
  unassigned: number; noActivity: number; stuckInStage: number; qcPending: number; overdue: number;
  cantContact: number; cannotGetIdCard: number; medianOpenAgeDays: number | null;
  medianTimeToDoneDays: number | null;
  slowestStage: { stageId: string; stageLabel: string; medianDays: number } | null;
  medianTimeInCurrentStageDays: number | null; activePeople: number;
  avgTasksPerPerson: number | null;
};

export type AcaOverviewStageRow = {
  stageId: string | null; stageLabel: string; stageColor: string | null;
  isTerminal: boolean; inStage: number; sharePercent: number | null;
  medianWaitDays: number | null; longestWaitDays: number | null;
  stuckCount: number | null; silentCount: number | null;
  /**
   * How many of `inStage` have a stage clock reconstructed by the 2026-08-09
   * backfill rather than measured. A count, not a boolean: with a boolean, one
   * old record marked the whole row as estimated, so nearly every row was
   * marked and the signal stopped meaning anything. Null on terminal rows,
   * which report no waiting figures at all.
   */
  estimatedCount: number | null;
};

export type AcaOverviewActionRow = {
  recordId: string; taskId: string | null; clientName: string | null;
  agentEmail: string | null; responsibleEmail: string | null; callerEmail: string | null;
  stageLabel: string | null; stageColor: string | null;
  daysInStage: number | null; daysSilent: number | null;
  createdAt: string; lastActivityAt: string | null;
  sortDays: number; stageAgeEstimated: boolean; updatedAt?: string | null;
};

export type AcaOverviewPeopleRow = {
  email: string | null; name: string | null; holding: number; stuck: number;
  silent: number; medianWaitDays: number | null; longestWaitDays: number | null;
  doneInPeriod: number;
  /**
   * `team` is the whole-team baseline every per-person number must be read
   * against — without it a bad percentage cannot be told apart from a bad
   * stage. `unassigned` is not a person and never joins the ranking.
   */
  kind: "person" | "team" | "unassigned";
};

export type AcaOverviewMatrixCell = {
  tasks: number; stuck: number; silent: number; medianStuckDays: number | null;
};
export type AcaOverviewMatrix = {
  stageIds: string[]; stageLabels: string[];
  rows: { email: string | null; name: string | null; cells: AcaOverviewMatrixCell[] }[];
  totals: AcaOverviewMatrixCell[];
};
export type AcaOverviewQueueCard = {
  email: string; name: string | null; lastAssignedAt: string | null; holding: number; stuck: number;
};
export type AcaOverviewSnapshot = {
  generatedAt: string; period: { from: string; to: string };
  thresholdDays: AcaOverviewThresholdDays; scorecards: AcaOverviewScorecards;
  stageTable: AcaOverviewStageRow[]; actions: AcaOverviewActionRow[];
  people: AcaOverviewPeopleRow[]; matrix: AcaOverviewMatrix;
  queue: AcaOverviewQueueCard[]; unassigned: AcaOverviewActionRow[];
  personStageTiming: AcaPersonStageTiming;
};
