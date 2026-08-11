import { dateOnlyToEndOfDay, enrollmentIsOverdue } from "./helpers";
import { isMeasuredStageTime, secondsInCurrentStage } from "./stage-time";
import type { EnrollmentRecord } from "./types";
import { formatDurationSeconds } from "@/lib/tasks/sla";

type TimeProgressRecord = Pick<
  EnrollmentRecord,
  | "due_date"
  | "closed_at"
  | "stage_entered_at"
  | "stage_entered_source"
>;

export type EnrollmentTimeProgress = {
  label: string;
  title: string;
  className: string;
};

function elapsedSinceSeconds(value: string, now: Date): number | null {
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((now.getTime() - startedAt) / 1000));
}

/**
 * Enrollment has due dates and per-stage dwell tracking, but no SLA budget.
 * Keep the CS Time Progress presentation while preserving that distinction:
 * due-date overdue wins, otherwise the cell reports the current stage dwell.
 */
export function buildEnrollmentTimeProgress(
  record: TimeProgressRecord,
  stageLabel: string | null,
  now: Date
): EnrollmentTimeProgress {
  const displayStage = stageLabel?.trim() || "Current stage";

  if (record.closed_at) {
    const elapsed = elapsedSinceSeconds(record.closed_at, now);
    return {
      label:
        elapsed === null
          ? displayStage
          : `${displayStage} ${formatDurationSeconds(elapsed)} ago`,
      title: "Time since this enrollment was closed.",
      className: "text-[#006644]",
    };
  }

  if (enrollmentIsOverdue(record, now) && record.due_date) {
    const dueAt = dateOnlyToEndOfDay(record.due_date).getTime();
    const overdueSeconds = Math.max(
      60,
      Math.floor((now.getTime() - dueAt) / 1000)
    );
    return {
      label: `Overdue by ${formatDurationSeconds(overdueSeconds)}`,
      title: `Enrollment due date ${record.due_date} has passed.`,
      className: "text-[#bf2600]",
    };
  }

  const elapsed = secondsInCurrentStage(record, now);
  if (elapsed === null) {
    return {
      label: "—",
      title: "Stage timing is not available for this enrollment yet.",
      className: "text-[#6b778c]",
    };
  }

  return {
    label: `${displayStage} for ${formatDurationSeconds(elapsed)}`,
    title: isMeasuredStageTime(record)
      ? "Time measured in the current enrollment stage."
      : "Estimated time in the current enrollment stage from existing record history.",
    className: "text-[#42526e]",
  };
}
