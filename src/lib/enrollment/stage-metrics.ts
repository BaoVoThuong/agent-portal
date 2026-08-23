import { getSupabaseAdmin } from "@/lib/supabase";
import { assertEnrollmentRecordsComplete } from "./queries";
import { applyEnrollmentScope, type EnrollmentScope } from "./scope";
import { summarizeDurations } from "./stage-time";
import type { EnrollmentOption, EnrollmentProgram } from "./types";
import type { EnrollmentOverviewStageDwellMetric } from "./overview-types";

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 50;
const LOOKBACK_DAYS = 90;

type CycleRow = { stage_id: string; duration_seconds: number | null };

export function summarizeStageDwell(
  rows: readonly CycleRow[],
  stageOptions: readonly EnrollmentOption[]
): EnrollmentOverviewStageDwellMetric[] {
  const byStage = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.stage_id || row.duration_seconds === null) continue;
    const list = byStage.get(row.stage_id) ?? [];
    list.push(Math.max(0, Number(row.duration_seconds)));
    byStage.set(row.stage_id, list);
  }
  const stages = new Map(stageOptions.map((option) => [option.id, option]));
  return [...byStage.entries()]
    .map(([stageId, durations]) => {
      const option = stages.get(stageId);
      const summary = summarizeDurations(durations);
      return {
        stageId,
        stageLabel: option?.label ?? "Archived stage",
        stageColor: option?.color ?? null,
        ...summary,
      };
    })
    .sort((a, b) => a.stageLabel.localeCompare(b.stageLabel, undefined, { numeric: true }));
}

export async function fetchStageDwellMetrics(
  program: EnrollmentProgram,
  scope: EnrollmentScope,
  stageOptions: readonly EnrollmentOption[],
  now = new Date()
): Promise<EnrollmentOverviewStageDwellMetric[]> {
  const supabase = getSupabaseAdmin();
  const recordsQuery = supabase
    .from("enrollment_records")
    .select("id", { count: "exact" })
    .eq("program", program)
    .is("archived_at", null);
  const { data: recordRows, error: recordError, count } = await applyEnrollmentScope(recordsQuery, scope);
  if (recordError) throw new Error(recordError.message);
  assertEnrollmentRecordsComplete(recordRows, count);
  const recordIds = ((recordRows ?? []) as { id: string }[]).map((row) => row.id);
  if (recordIds.length === 0) return [];

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);
  const batches = await Promise.all(Array.from({ length: Math.ceil(recordIds.length / ID_CHUNK_SIZE) }, (_, chunkIndex) => {
    const ids = recordIds.slice(chunkIndex * ID_CHUNK_SIZE, (chunkIndex + 1) * ID_CHUNK_SIZE);
    return (async () => {
      const rows: CycleRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await supabase
        .from("enrollment_stage_cycles")
        .select("stage_id,duration_seconds")
        .in("record_id", ids)
        .eq("program", program)
        .eq("kind", "dwell")
        .eq("source", "live")
        .not("ended_at", "is", null)
        .gte("ended_at", cutoff.toISOString())
        .range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new Error(result.error.message);
      const page = (result.data ?? []) as CycleRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE || (typeof result.count === "number" && offset + page.length >= result.count)) break;
    }
      return rows;
    })();
  }));
  return summarizeStageDwell(batches.flat(), stageOptions);
}
