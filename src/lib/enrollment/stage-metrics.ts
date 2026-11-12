import { getSupabaseAdmin } from "@/lib/supabase";
import { readAllRowsById } from "@/lib/pagination/all-rows";
import { mapWithConcurrency } from "@/lib/pagination/concurrency";
import { applyEnrollmentScope, type EnrollmentScope } from "./scope";
import { summarizeDurations } from "./stage-time";
import type { EnrollmentOption, EnrollmentProgram } from "./types";
import type { EnrollmentOverviewStageDwellMetric } from "./overview-types";

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
  const { data: recordRows, error: recordError } = await readAllRowsById<{ id: string }>(
    (afterId, pageSize, withCount) => {
      let query = supabase.from("enrollment_records")
        .select("id", withCount ? { count: "exact" } : undefined)
        .eq("program", program).is("archived_at", null);
      if (afterId) query = query.gt("id", afterId);
      return applyEnrollmentScope(query, scope).order("id").limit(pageSize);
    },
  );
  if (recordError) throw new Error(recordError.message);
  const recordIds = ((recordRows ?? []) as { id: string }[]).map((row) => row.id);
  if (recordIds.length === 0) return [];

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);
  const idChunks = Array.from(
    { length: Math.ceil(recordIds.length / ID_CHUNK_SIZE) },
    (_, chunkIndex) => recordIds.slice(chunkIndex * ID_CHUNK_SIZE, (chunkIndex + 1) * ID_CHUNK_SIZE),
  );
  const batches = await mapWithConcurrency(idChunks, 4, async (ids) => {
      const result = await readAllRowsById<{ id: string; stage_id: string; duration_seconds: number | null }>(
        (afterId, pageSize, withCount) => {
          let query = supabase
        .from("enrollment_stage_cycles")
        .select("id,stage_id,duration_seconds", withCount ? { count: "exact" } : undefined)
        .in("record_id", ids)
        .eq("program", program)
        .eq("kind", "dwell")
        .eq("source", "live")
        .not("ended_at", "is", null)
        .gte("ended_at", cutoff.toISOString());
          if (afterId) query = query.gt("id", afterId);
          return query.order("id").limit(pageSize);
        },
      );
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []) as CycleRow[];
  });
  return summarizeStageDwell(batches.flat(), stageOptions);
}
