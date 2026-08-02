import type { EnrollmentProgram } from "./types";

export const ENROLLMENT_OVERVIEW_STATUSES = ["free", "ok", "busy", "overloaded"] as const;
export type EnrollmentOverviewStatus = (typeof ENROLLMENT_OVERVIEW_STATUSES)[number];

// Enrollment does not have an SLA/overdue workflow yet. Until that exists,
// overview risk stays limited to explicit ownership/QC data.
export const ENROLLMENT_OVERVIEW_RISK_FLAGS = [
  "qc_stale",
  "missing_owner",
  "no_due_date",
] as const;
export type EnrollmentOverviewRiskFlag = (typeof ENROLLMENT_OVERVIEW_RISK_FLAGS)[number];

// Count-based thresholds (no SLA-minutes axis exists for Enrollment).
// Starter values — same "just a constant" pattern CS's OVERVIEW_THRESHOLDS
// uses; revisit once real per-person open-load volume is observed.
export const ENROLLMENT_OVERVIEW_THRESHOLDS = {
  version: "v1",
  openBusy: 5,
  openOverloaded: 10,
} as const;
export type EnrollmentOverviewThresholds = typeof ENROLLMENT_OVERVIEW_THRESHOLDS;

export type EnrollmentOverviewAccount = {
  email: string;
  name: string | null;
  isActive: boolean;
  canWork: boolean;
  isAdmin: boolean;
};

export type EnrollmentOverviewRecordInput = {
  id: string;
  program: EnrollmentProgram;
  client_name: string | null;
  stage_id: string | null;
  caller_email?: string | null;
  responsible_enroll_email: string | null;
  created_by_email?: string | null;
  due_date: string | null;
  qc_checked_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type EnrollmentOverviewRecordSummary = {
  id: string;
  clientName: string | null;
  stageId: string | null;
  createdAt: string;
  dueDate: string | null;
  riskFlags: EnrollmentOverviewRiskFlag[];
};

export type EnrollmentOverviewRow = {
  email: string;
  name: string | null;
  openCount: number;
  qcStaleCount: number;
  riskFlags: EnrollmentOverviewRiskFlag[];
  oldestOpenCreatedAt: string | null;
  oldestOpenAgeSeconds: number | null;
  done7d: number;
  status: EnrollmentOverviewStatus;
  records: EnrollmentOverviewRecordSummary[];
};

export type EnrollmentOverviewAttentionBar = {
  key: EnrollmentOverviewRiskFlag;
  label: string;
  recordCount: number;
  affectedPeopleCount: number;
};

// One bucket per stage that has >=1 open record, ordered by stage label.
// A literal stage x risk-tone matrix (like CS's fixed 5-status table) isn't a
// good fit here because ACA alone has 14 configurable stages — a histogram
// with risk-tone shading scales to however many stages are actually in use.
export type EnrollmentOverviewStageBucket = {
  stageId: string;
  stageLabel: string;
  stageColor: string | null;
  total: number;
  danger: number;
  warning: number;
  ok: number;
};

export type EnrollmentOverviewWorkMix = {
  stages: EnrollmentOverviewStageBucket[];
};

export type EnrollmentOverviewKpis = {
  peopleCount: number;
  zeroLoadCount: number;
  openRecordCount: number;
  needsAttentionCount: number;
  unassignedCount: number;
};

export type EnrollmentUnassignedOverviewRecord = {
  id: string;
  clientName: string | null;
  stageId: string | null;
  stageLabel: string | null;
  stageColor: string | null;
  dueDate: string | null;
  createdAt: string;
  ageSeconds: number;
};

export type EnrollmentOverviewSnapshot = {
  program: EnrollmentProgram;
  generatedAt: string;
  thresholds: EnrollmentOverviewThresholds;
  kpis: EnrollmentOverviewKpis;
  attention: EnrollmentOverviewAttentionBar[];
  workMix: EnrollmentOverviewWorkMix;
  rows: EnrollmentOverviewRow[];
  unassigned: EnrollmentUnassignedOverviewRecord[];
};

export type EnrollmentRecommendationCandidate = {
  email: string;
  name: string | null;
  currentStatus: EnrollmentOverviewStatus;
  projectedStatus: EnrollmentOverviewStatus;
  openCount: number;
  projectedOpenCount: number;
  hasRiskFlag: boolean;
  why: string;
};
