import type { AcaOverviewRecord } from "./aca-overview-types";
const MS_PER_DAY = 86_400_000;
function wholeDaysBetween(startIso: string, now: Date): number | null {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / MS_PER_DAY));
}
export function daysInStage(record: AcaOverviewRecord, now: Date): number | null {
  return record.stage_entered_at ? wholeDaysBetween(record.stage_entered_at, now) : null;
}
export function isEstimatedStageAge(record: AcaOverviewRecord): boolean {
  return record.stage_entered_source !== "live";
}
export function daysSilent(record: AcaOverviewRecord, now: Date): number | null {
  if (record.last_work_activity_at) return wholeDaysBetween(record.last_work_activity_at, now);
  return daysInStage(record, now) ?? wholeDaysBetween(record.created_at, now);
}
export function isStuck(days: number | null, thresholdDays: number): boolean {
  return days !== null && days >= thresholdDays;
}
export function isSilent(days: number | null, thresholdDays: number): boolean {
  return days !== null && days >= thresholdDays;
}
export function medianDays(values: readonly (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
