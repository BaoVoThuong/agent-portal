import type { EnrollmentOption, EnrollmentProgram } from "./types";

export const ENROLLMENT_OVERVIEW_RISK_FLAGS = [
  "overdue",
  "due_soon",
  "missing_required",
  "qc_pending",
  "unowned",
  "blocking_stage",
] as const;
export type EnrollmentOverviewRiskFlag = (typeof ENROLLMENT_OVERVIEW_RISK_FLAGS)[number];

export const ENROLLMENT_OVERVIEW_COLLECTABLE_KEYS = [
  "carrier",
  "payment",
  "aca",
  "consent",
  "platform",
  "pcp2025",
  "pcp2026",
] as const;
export type EnrollmentOverviewCollectableKey =
  (typeof ENROLLMENT_OVERVIEW_COLLECTABLE_KEYS)[number];

export type EnrollmentOverviewRequiredColumn = {
  key: string;
  label: string;
  type: string;
  is_system: boolean;
};

export type EnrollmentOverviewRecordInput = {
  id: string;
  program: EnrollmentProgram;
  client_name: string | null;
  description: string | null;
  fub_link: string | null;
  stage_id: string | null;
  carrier_id: string | null;
  platform_id: string | null;
  consent_id: string | null;
  payment_status_id: string | null;
  aca_status_id: string | null;
  pcp_2025: string | null;
  pcp_2026: string | null;
  custom_values?: Record<string, unknown> | null;
  agent_email: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  due_date: string | null;
  qc_checked_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type EnrollmentOverviewAccount = {
  email: string;
  name: string | null;
  isActive: boolean;
  canWork: boolean;
  isAdmin: boolean;
};

export type EnrollmentOverviewThresholds = {
  dueSoonDays: number;
  defaultPeriod: "thisMonth";
};

export type EnrollmentOverviewPeriod = {
  from: string;
  to: string;
};

export type EnrollmentOverviewRecordSummary = {
  id: string;
  clientName: string | null;
  stageId: string | null;
  stageLabel: string | null;
  stageColor: string | null;
  responsibleEmail: string | null;
  dueDate: string | null;
  createdAt: string;
  closedAt: string | null;
  riskFlags: EnrollmentOverviewRiskFlag[];
  missingItems: string[];
};

export type EnrollmentOverviewNeed = {
  key: EnrollmentOverviewRiskFlag;
  label: string;
  count: number;
  records: EnrollmentOverviewRecordSummary[];
};

export type EnrollmentOverviewFunnelStage = {
  stageId: string;
  stageLabel: string;
  stageColor: string | null;
  openCount: number;
};

export type EnrollmentOverviewWeeklyPoint = {
  weekStart: string;
  label: string;
  newCount: number;
  closedCount: number;
};

export type EnrollmentOverviewCycleMetric = {
  stageId: string | null;
  stageLabel: string;
  count: number;
  medianDays: number | null;
  p90Days: number | null;
};

export type EnrollmentOverviewMissingItem = {
  key: string;
  label: string;
  missingCount: number;
  applicableCount: number;
};

export type EnrollmentOverviewCompleteness = {
  percentage: number | null;
  filledCount: number;
  applicableCount: number;
};

export type EnrollmentOverviewOutcome = {
  successCount: number;
  lostCount: number;
  closedCount: number;
};

export type EnrollmentOverviewKpis = {
  openCount: number;
  newCount: number;
  closedCount: number;
  netChange: number;
  needsCareCount: number;
  overdueCount: number;
};

export type EnrollmentOverviewSnapshot = {
  program: EnrollmentProgram;
  generatedAt: string;
  period: EnrollmentOverviewPeriod;
  thresholds: EnrollmentOverviewThresholds;
  kpis: EnrollmentOverviewKpis;
  funnel: EnrollmentOverviewFunnelStage[];
  weekly: EnrollmentOverviewWeeklyPoint[];
  cycleTime: EnrollmentOverviewCycleMetric[];
  needsCare: EnrollmentOverviewNeed[];
  missingItems: EnrollmentOverviewMissingItem[];
  completeness: EnrollmentOverviewCompleteness;
  outcome: EnrollmentOverviewOutcome | null;
  stageOptions: EnrollmentOption[];
};
