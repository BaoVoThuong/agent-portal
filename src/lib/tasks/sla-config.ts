// Presentation + validation constants for the SLA admin UI.
//
// These used to live as bare literals inside the old SLA modal, which meant
// three business rules (SLA caps at one week, SLA is set in 5-minute steps,
// and these reminder fields are editable) existed only inside a component.
//
// SLA math stays in ./sla.ts. This file is deliberately free of logic that
// the cron/overdue engine depends on.
import { TASK_PRIORITIES, type TaskPriority } from "./types";
import type { ReminderSettings } from "./reminder-settings";

/** Allowed range for a single SLA rule, in minutes. */
export const SLA_DURATION_BOUNDS = {
  minMinutes: 1,
  maxMinutes: 168 * 60,
} as const;

/** SLA durations are chosen in 5-minute increments. */
export const SLA_MINUTE_STEP = 5;

/** Hour choices: 0h through 168h, derived from the shared maximum. */
export const SLA_HOUR_OPTIONS: readonly number[] = Array.from(
  { length: Math.floor(SLA_DURATION_BOUNDS.maxMinutes / 60) + 1 },
  (_, index) => index
);

/** Minute choices: 0, 5, through 55, derived from the shared step. */
export const SLA_MINUTE_OPTIONS: readonly number[] = Array.from(
  { length: Math.floor(60 / SLA_MINUTE_STEP) },
  (_, index) => index * SLA_MINUTE_STEP
);

/**
 * Minute choices that keep a composed hour/minute value inside the allowed
 * duration bounds. The lower bound matters for the 0h row; 0h 0m is not a
 * valid SLA even though zero is a valid minute choice for every other hour.
 */
export function slaMinuteOptionsForHours(hours: number): readonly number[] {
  const minMinutes = Math.max(0, SLA_DURATION_BOUNDS.minMinutes - hours * 60);
  const maxMinutes = SLA_DURATION_BOUNDS.maxMinutes - hours * 60;
  return SLA_MINUTE_OPTIONS.filter(
    (minute) => minute >= minMinutes && minute <= maxMinutes
  );
}

/** Keep the current minute value valid when the hour selection changes. */
export function normalizeSlaMinutesForHours(hours: number, minutes: number): number {
  const options = slaMinuteOptionsForHours(hours);
  return options.includes(minutes) ? minutes : (options[0] ?? 0);
}

/** React key for the priority-only (no category) SLA rule row. */
export const SLA_DEFAULT_CATEGORY_ROW_KEY = "__default__";

/** Total priority labels used by the SLA editor. */
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** Editable reminder fields in display order. */
export const REMINDER_FIELDS: ReadonlyArray<{
  key: keyof ReminderSettings;
  label: string;
  unit: string;
}> = [
  { key: "dueSoonMinutes", label: "Due soon", unit: "min" },
  { key: "todoHours", label: "To Do reminders", unit: "h" },
  { key: "overdueReminderHours", label: "Overdue reminders", unit: "h" },
  { key: "waitingHours", label: "Waiting reminders", unit: "h" },
  { key: "staleHours", label: "Stale reminders", unit: "h" },
  { key: "qcHours", label: "QC reminders", unit: "h" },
];

/** Shared by the UI and API so both enforce exactly the same range. */
export function isSlaDurationInBounds(totalMinutes: number): boolean {
  return (
    Number.isFinite(totalMinutes) &&
    Number.isInteger(totalMinutes) &&
    totalMinutes >= SLA_DURATION_BOUNDS.minMinutes &&
    totalMinutes <= SLA_DURATION_BOUNDS.maxMinutes
  );
}

/** Priority order used by the SLA editor's left-hand navigation. */
export const SLA_PRIORITY_ORDER = TASK_PRIORITIES;
