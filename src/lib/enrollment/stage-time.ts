export type StageEnteredSource = "live" | "history_backfill" | "record_created";

export type StageTimeRecord = {
  stage_entered_at: string | null;
  stage_entered_source: StageEnteredSource | null;
};

export function secondsInCurrentStage(record: StageTimeRecord, now = new Date()): number | null {
  if (!record.stage_entered_at) return null;
  const started = new Date(record.stage_entered_at).getTime();
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

export function isMeasuredStageTime(record: StageTimeRecord): boolean {
  return record.stage_entered_source === "live";
}

export const MIN_DURATION_SAMPLE = 10;

export type DurationSummary = {
  sampleSize: number;
  medianSeconds: number | null;
  p75Seconds: number | null;
  p90Seconds: number | null;
  measured: boolean;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function summarizeDurations(
  durations: readonly number[],
  measured = true
): DurationSummary {
  const sorted = durations.filter(Number.isFinite).map((value) => Math.max(0, value)).sort((a, b) => a - b);
  const sampleSize = sorted.length;
  if (sampleSize === 0) {
    return { sampleSize, medianSeconds: null, p75Seconds: null, p90Seconds: null, measured };
  }
  const middle = Math.floor(sampleSize / 2);
  const medianSeconds = sampleSize % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    sampleSize,
    medianSeconds,
    p75Seconds: percentile(sorted, 0.75),
    p90Seconds: percentile(sorted, 0.9),
    measured: measured && sampleSize >= MIN_DURATION_SAMPLE,
  };
}
