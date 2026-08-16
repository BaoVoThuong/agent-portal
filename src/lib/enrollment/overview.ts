import { compareEnrollmentOptionLabels } from "./options";
import type { EnrollmentOption, EnrollmentProgram } from "./types";
import {
  type EnrollmentOverviewAccount,
  type EnrollmentOverviewCollectableKey,
  type EnrollmentOverviewCycleMetric,
  type EnrollmentOverviewFunnelStage,
  type EnrollmentOverviewMissingItem,
  type EnrollmentOverviewNeed,
  type EnrollmentOverviewRecordInput,
  type EnrollmentOverviewRecordSummary,
  type EnrollmentOverviewRequiredColumn,
  type EnrollmentOverviewRiskFlag,
  type EnrollmentOverviewSnapshot,
  type EnrollmentOverviewThresholds,
  type EnrollmentOverviewWeeklyPoint,
} from "./overview-types";

export const ENROLLMENT_OVERVIEW_THRESHOLDS: EnrollmentOverviewThresholds = {
  dueSoonDays: 3,
  defaultPeriod: "thisMonth",
};

const COLLECTABLE_LABELS: Record<EnrollmentOverviewCollectableKey, string> = {
  carrier: "Carrier",
  payment: "Payment status",
  aca: "AC status",
  consent: "Consent",
  platform: "Platform",
  pcp2025: "PCP 2025",
  pcp2026: "PCP 2026",
};

const NEED_LABELS: Record<EnrollmentOverviewRiskFlag, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  missing_required: "Missing required info",
  qc_pending: "QC pending",
  unowned: "Unowned",
  blocking_stage: "Blocking stage",
};

const ACA_COLLECTABLE_KEYS: EnrollmentOverviewCollectableKey[] = [
  "carrier",
  "payment",
  "aca",
  "consent",
  "platform",
  "pcp2025",
  "pcp2026",
];
const MEDICARE_COLLECTABLE_KEYS: EnrollmentOverviewCollectableKey[] = ["carrier", "pcp2025"];
const MEDICARE_BLOCKING_STAGE_LABELS = new Set(["10-id card unavailable", "e- id card unavailable"]);
const SUCCESS_STAGE_LABELS = new Set(["10-id card done", "10-done", "9-id card done"]);
const TERMINATED_STAGE_LABELS = new Set(["12-terminated", "11-terminated"]);

function normalizeLabel(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function defaultEnrollmentOverviewPeriod(now: Date): { from: string; to: string } {
  const today = dateKey(now);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: dateKey(first), to: today };
}

function isInPeriod(value: string | null | undefined, period: { from: string; to: string }): boolean {
  if (!value) return false;
  if (!period.from && !period.to) return true;
  const key = value.slice(0, 10);
  return (!period.from || key >= period.from) && (!period.to || key <= period.to);
}

function daysBetween(start: string, end: Date): number {
  return Math.max(0, (end.getTime() - new Date(start).getTime()) / 86_400_000);
}

function valueForCollectable(
  record: EnrollmentOverviewRecordInput,
  key: EnrollmentOverviewCollectableKey
): unknown {
  switch (key) {
    case "carrier":
      return record.carrier_id;
    case "payment":
      return record.payment_status_id;
    case "aca":
      return record.aca_status_id;
    case "consent":
      return record.consent_id;
    case "platform":
      return record.platform_id;
    case "pcp2025":
      return record.pcp_2025;
    case "pcp2026":
      return record.pcp_2026;
  }
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function valueForRequiredColumn(
  record: EnrollmentOverviewRecordInput,
  column: EnrollmentOverviewRequiredColumn
): unknown {
  if (!column.is_system) return record.custom_values?.[column.key];
  const map: Record<string, unknown> = {
    client: record.client_name,
    client_name: record.client_name,
    description: record.description,
    fub: record.fub_link,
    fub_link: record.fub_link,
    due: record.due_date,
    due_date: record.due_date,
    stage: record.stage_id,
    stage_id: record.stage_id,
    carrier: record.carrier_id,
    carrier_id: record.carrier_id,
    platform: record.platform_id,
    platform_id: record.platform_id,
    consent: record.consent_id,
    consent_id: record.consent_id,
    payment: record.payment_status_id,
    payment_status_id: record.payment_status_id,
    aca: record.aca_status_id,
    aca_status_id: record.aca_status_id,
    pcp2025: record.pcp_2025,
    pcp_2025: record.pcp_2025,
    pcp2026: record.pcp_2026,
    pcp_2026: record.pcp_2026,
    agent: record.agent_email,
    agent_email: record.agent_email,
    caller: record.caller_email,
    caller_email: record.caller_email,
    responsible: record.responsible_enroll_email,
    responsible_enroll_email: record.responsible_enroll_email,
  };
  return map[column.key];
}

function requiredMissingItems(
  record: EnrollmentOverviewRecordInput,
  requiredColumns: EnrollmentOverviewRequiredColumn[]
): string[] {
  return requiredColumns
    .filter((column) => !isFilled(valueForRequiredColumn(record, column)))
    .map((column) => column.label);
}

function stageIsBlocking(program: EnrollmentProgram, stage: EnrollmentOption | null): boolean {
  if (!stage) return false;
  if (program === "aca") return Boolean(stage.is_terminal);
  return MEDICARE_BLOCKING_STAGE_LABELS.has(normalizeLabel(stage.label));
}

function summaryFor(
  record: EnrollmentOverviewRecordInput,
  stage: EnrollmentOption | null,
  riskFlags: EnrollmentOverviewRiskFlag[],
  missingItems: string[]
): EnrollmentOverviewRecordSummary {
  return {
    id: record.id,
    clientName: record.client_name,
    stageId: record.stage_id,
    stageLabel: stage?.label ?? null,
    stageColor: stage?.color ?? null,
    responsibleEmail: record.responsible_enroll_email,
    dueDate: record.due_date,
    createdAt: record.created_at,
    closedAt: record.closed_at,
    riskFlags,
    missingItems,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function weekStartKey(value: Date): string {
  const day = value.getUTCDay();
  return dateKey(addDays(value, -day));
}

function formatWeekLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    parseDateKey(value)
  );
}

function buildWeeklySeries(
  records: EnrollmentOverviewRecordInput[],
  now: Date,
  period: { from: string; to: string }
): EnrollmentOverviewWeeklyPoint[] {
  const end = period.to ? parseDateKey(period.to) : now;
  const start = period.from ? parseDateKey(period.from) : addDays(end, -83);
  const lastWeek = parseDateKey(weekStartKey(end));
  const requestedFirstWeek = parseDateKey(weekStartKey(start));
  const minimumFirstWeek = addDays(lastWeek, -49);
  const firstWeek = requestedFirstWeek > minimumFirstWeek ? minimumFirstWeek : requestedFirstWeek;
  const weeks: EnrollmentOverviewWeeklyPoint[] = [];
  for (let cursor = firstWeek; cursor <= lastWeek; cursor = addDays(cursor, 7)) {
    const key = dateKey(cursor);
    weeks.push({ weekStart: key, label: formatWeekLabel(key), newCount: 0, closedCount: 0 });
  }
  const boundedWeeks = weeks.length > 12 ? weeks.slice(-12) : weeks;
  const byWeek = new Map(boundedWeeks.map((week) => [week.weekStart, week]));
  for (const record of records) {
    if (isInPeriod(record.created_at, period)) {
      const bucket = byWeek.get(weekStartKey(new Date(record.created_at)));
      if (bucket) bucket.newCount += 1;
    }
    if (isInPeriod(record.closed_at, period)) {
      const bucket = byWeek.get(weekStartKey(new Date(record.closed_at!)));
      if (bucket) bucket.closedCount += 1;
    }
  }
  return boundedWeeks;
}

function buildCycleMetrics(
  records: EnrollmentOverviewRecordInput[],
  stageById: Map<string, EnrollmentOption>,
  period: { from: string; to: string }
): EnrollmentOverviewCycleMetric[] {
  const values = new Map<string, { stageId: string | null; label: string; days: number[] }>();
  for (const record of records) {
    if (!record.closed_at || !isInPeriod(record.closed_at, period)) continue;
    const stage = record.stage_id ? stageById.get(record.stage_id) ?? null : null;
    const key = record.stage_id ?? "__unknown__";
    const bucket = values.get(key) ?? {
      stageId: record.stage_id,
      label: stage?.label ?? "Unknown outcome",
      days: [],
    };
    bucket.days.push(daysBetween(record.created_at, new Date(record.closed_at)));
    values.set(key, bucket);
  }
  return [...values.values()]
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    .map((bucket) => ({
      stageId: bucket.stageId,
      stageLabel: bucket.label,
      count: bucket.days.length,
      medianDays: median(bucket.days),
      p90Days: percentile(bucket.days, 90),
    }));
}

export function aggregateEnrollmentOverview(input: {
  now: Date;
  program: EnrollmentProgram;
  period: { from: string; to: string };
  accounts: EnrollmentOverviewAccount[];
  stageOptions: EnrollmentOption[];
  records: EnrollmentOverviewRecordInput[];
  requiredColumns: EnrollmentOverviewRequiredColumn[];
  thresholds?: EnrollmentOverviewThresholds;
}): EnrollmentOverviewSnapshot {
  const thresholds = input.thresholds ?? ENROLLMENT_OVERVIEW_THRESHOLDS;
  const period = input.period;
  const stageById = new Map(input.stageOptions.map((option) => [option.id, option]));
  const sortedStages = [...input.stageOptions].sort(compareEnrollmentOptionLabels);
  const activeRecords = input.records.filter((record) => !record.archived_at);
  const today = dateKey(input.now);
  const dueSoonEnd = dateKey(addDays(parseDateKey(today), thresholds.dueSoonDays));
  const collectables =
    input.program === "aca" ? ACA_COLLECTABLE_KEYS : MEDICARE_COLLECTABLE_KEYS;
  const derived = activeRecords.map((record) => {
    const stage = record.stage_id ? stageById.get(record.stage_id) ?? null : null;
    const open = !record.closed_at;
    const requiredMissing = requiredMissingItems(record, input.requiredColumns);
    const missingItems = [
      ...collectables
        .filter((key) => !isFilled(valueForCollectable(record, key)))
        .map((key) => COLLECTABLE_LABELS[key]),
      ...input.requiredColumns
        .filter((column) => !column.is_system)
        .filter((column) => !isFilled(valueForRequiredColumn(record, column)))
        .map((column) => column.label),
    ];
    const uniqueMissingItems = [...new Set(missingItems)];
    const overdue = Boolean(open && record.due_date && record.due_date < today);
    const dueSoon = Boolean(
      open && record.due_date && record.due_date >= today && record.due_date <= dueSoonEnd
    );
    const qcPending = Boolean(stage?.triggers_qc && !record.qc_checked_at);
    const unowned = Boolean(open && !record.responsible_enroll_email);
    const blockingStage = Boolean(open && stageIsBlocking(input.program, stage));
    const riskFlags: EnrollmentOverviewRiskFlag[] = [];
    if (overdue) riskFlags.push("overdue");
    if (dueSoon) riskFlags.push("due_soon");
    if (open && requiredMissing.length > 0) riskFlags.push("missing_required");
    if (qcPending) riskFlags.push("qc_pending");
    if (unowned) riskFlags.push("unowned");
    if (blockingStage) riskFlags.push("blocking_stage");
    return {
      record,
      stage,
      open,
      missingItems: uniqueMissingItems,
      riskFlags,
      summary: summaryFor(record, stage, riskFlags, uniqueMissingItems),
    };
  });

  const openRecords = derived.filter((item) => item.open);
  const periodNew = activeRecords.filter((record) => isInPeriod(record.created_at, period.from ? period : { from: "", to: "" })).length;
  const periodClosed = activeRecords.filter((record) => isInPeriod(record.closed_at, period.from ? period : { from: "", to: "" })).length;
  const needsCareIds = new Set(
    derived.filter((item) => item.riskFlags.length > 0).map((item) => item.record.id)
  );

  const needsCare: EnrollmentOverviewNeed[] = (Object.keys(NEED_LABELS) as EnrollmentOverviewRiskFlag[]).map(
    (key) => {
      const records = derived.filter((item) => item.riskFlags.includes(key)).map((item) => item.summary);
      return { key, label: NEED_LABELS[key], count: records.length, records };
    }
  );

  const funnel: EnrollmentOverviewFunnelStage[] = sortedStages.map((stage) => ({
    stageId: stage.id,
    stageLabel: stage.label,
    stageColor: stage.color,
    openCount: openRecords.filter((item) => item.record.stage_id === stage.id).length,
  }));
  const noStageCount = openRecords.filter((item) => !item.record.stage_id).length;
  if (noStageCount > 0) {
    funnel.push({ stageId: "__none__", stageLabel: "No stage", stageColor: null, openCount: noStageCount });
  }

  const applicableCount = openRecords.length * (collectables.length + input.requiredColumns.filter((column) => !column.is_system).length);
  const missingItems: EnrollmentOverviewMissingItem[] = [
    ...collectables.map((key) => {
      const missingCount = openRecords.filter((item) => !isFilled(valueForCollectable(item.record, key))).length;
      return { key, label: COLLECTABLE_LABELS[key], missingCount, applicableCount: openRecords.length };
    }),
    ...input.requiredColumns
      .filter((column) => !column.is_system)
      .map((column) => ({
        key: column.key,
        label: column.label,
        missingCount: openRecords.filter((item) => !isFilled(valueForRequiredColumn(item.record, column))).length,
        applicableCount: openRecords.length,
      })),
  ];
  const missingValueCount = missingItems.reduce((sum, item) => sum + item.missingCount, 0);
  const totalValues = applicableCount;
  const completeness = {
    percentage: totalValues === 0 ? null : Math.round(((totalValues - missingValueCount) / totalValues) * 100),
    filledCount: totalValues - missingValueCount,
    applicableCount: totalValues,
  };

  const terminalClosed = activeRecords.filter(
    (record) => record.closed_at && isInPeriod(record.closed_at, period) && record.stage_id
  );
  const successCount = terminalClosed.filter((record) => SUCCESS_STAGE_LABELS.has(normalizeLabel(stageById.get(record.stage_id!)?.label))).length;
  const lostCount = terminalClosed.filter((record) => TERMINATED_STAGE_LABELS.has(normalizeLabel(stageById.get(record.stage_id!)?.label))).length;

  return {
    program: input.program,
    generatedAt: input.now.toISOString(),
    period,
    thresholds,
    kpis: {
      openCount: openRecords.length,
      newCount: periodNew,
      closedCount: periodClosed,
      netChange: periodNew - periodClosed,
      needsCareCount: needsCareIds.size,
      overdueCount: derived.filter((item) => item.riskFlags.includes("overdue")).length,
    },
    openRecords: openRecords.map((item) => item.summary),
    funnel,
    weekly: buildWeeklySeries(activeRecords, input.now, period),
    cycleTime: buildCycleMetrics(activeRecords, stageById, period),
    stageDwell: [],
    needsCare,
    missingItems,
    completeness,
    outcome:
      input.program === "aca"
        ? { successCount, lostCount, closedCount: terminalClosed.length }
        : null,
    stageOptions: sortedStages,
  };
}
